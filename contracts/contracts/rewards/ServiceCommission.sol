// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {JanSetuRegistry} from "../core/JanSetuRegistry.sol";
import {CommissionManager} from "./CommissionManager.sol";

interface IEscrowView {
    function orders(uint256 id) external view returns (address locker, address beneficiary, uint128 amount, uint64 createdAt, uint64 deadline, uint8 kind, uint8 status);
}
interface IMicroView {
    struct Loan {
        address borrower; address verifier;
        uint128 principal; uint128 totalDue; uint128 installment; uint128 paid; uint128 principalRepaid;
        uint32 count; uint32 paidCount; uint64 nextDue; uint8 tier; bool reliefUsed; uint8 status;
    }
    function getLoan(uint256 id) external view returns (Loan memory);
}
interface IRanksView { function districtVolume(uint32 d) external view returns (uint256); function totalDistrictVolume() external view returns (uint256); }

/// @title Service commissions (deck slide 8, last column).
/// @dev Pays the non-deposit part of the network table from a FUNDED pool. Everything is permissionless and
///      read-only towards the services: anyone calls a `sync*` function, the contract reads what already happened
///      and pays each person once. If the pool cannot cover a payment the call reverts and can be retried after funding.
///        AGENT    1.5% of each completed P2P cash order, and 2.5% of loan repayments on loans the agent verified (recovery).
///        CLUSTER  0.75% of the principal of loans opened by customers verified by agents in the cluster (team loan volume).
///        STATE    1% of state turnover (completed P2P orders + loan principal in the state).
///        DISTRICT a share of the prediction-market fees: PredictionLP's protocol side is paid into this contract; `districtBps`
///                 of it is split between districts by their counted volume, the rest goes to the DAO treasury.
///        DAO      the remainder of the prediction fees; deposit commissions are in CommissionManager.
///      A missing head's share goes to the DAO address. Nothing here can touch savings, escrow or loan-pool money.
contract ServiceCommission is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 internal constant BPS = 10_000;
    uint256 internal constant ACC = 1e24;

    IERC20 public immutable token;
    JanSetuRegistry public immutable registry;
    CommissionManager public immutable commissions;
    IEscrowView public immutable escrow;
    IMicroView public immutable micro;
    address public immutable dao;
    IRanksView public ranks;

    uint16 public p2pAgentBps = 150; uint16 public recoveryAgentBps = 250; uint16 public clusterLoanBps = 75;
    uint16 public stateTurnoverBps = 100; uint16 public districtShareBps = 4000;

    uint256 public pool;          // funded, unspent
    uint256 public districtOwed;  // prediction share accrued to districts, not yet paid
    uint256 public accPerVolume;  // districts: accrued per unit of volume (scaled by ACC)
    mapping(uint32 => uint256) public districtPaidAcc;
    mapping(uint32 => uint256) public districtAccrued;

    mapping(uint256 => bool) public p2pPaid;
    mapping(uint256 => bool) public loanOpenPaid;
    mapping(uint256 => uint256) public recoveryBasis;

    event Funded(address indexed from, uint256 amount);
    event P2PPaid(uint256 indexed orderId, address indexed agent, uint256 agentFee, uint256 stateFee);
    event LoanOpenPaid(uint256 indexed loanId, uint256 clusterFee, uint256 stateFee);
    event RecoveryPaid(uint256 indexed loanId, address indexed agent, uint256 amount);
    event PredictionSwept(uint256 total, uint256 toDistricts, uint256 toDao);
    event DistrictPaid(uint32 indexed districtId, address indexed to, uint256 amount);
    event RatesSet();

    error PoolShort(); error NothingToPay(); error NotCompleted(); error NoAgent(); error NoDistrictWeight();

    constructor(address admin, IERC20 token_, JanSetuRegistry registry_, CommissionManager commissions_, address escrow_, address micro_, address dao_) {
        token = token_; registry = registry_; commissions = commissions_;
        escrow = IEscrowView(escrow_); micro = IMicroView(micro_); dao = dao_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ------------------------------------------------------------ governance
    function setRanks(address r) external onlyRole(DEFAULT_ADMIN_ROLE) { ranks = IRanksView(r); }

    function setRates(uint16 p2p, uint16 recovery, uint16 clusterLoan, uint16 stateTurnover, uint16 districtShare) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(p2p <= 500 && recovery <= 500 && clusterLoan <= 300 && stateTurnover <= 300 && districtShare <= BPS, "bounds");
        p2pAgentBps = p2p; recoveryAgentBps = recovery; clusterLoanBps = clusterLoan; stateTurnoverBps = stateTurnover; districtShareBps = districtShare;
        emit RatesSet();
    }

    function fund(uint256 amount) external nonReentrant {
        uint256 b = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        require(token.balanceOf(address(this)) - b == amount, "fee on transfer");
        pool += amount;
        emit Funded(msg.sender, amount);
    }

    // ------------------------------------------------------------ P2P: agent 1.5% + state 1%
    function syncP2P(uint256 orderId) external nonReentrant {
        if (p2pPaid[orderId]) revert NothingToPay();
        (address locker, address beneficiary, uint128 amount,,, uint8 kind, uint8 status) = escrow.orders(orderId);
        if (status != 2 && status != 6) revert NotCompleted();   // Released or ResolvedToBeneficiary
        address agent = kind == 0 ? locker : beneficiary;        // CashIn: locker is the agent
        if (agent == address(0)) revert NoAgent();
        uint256 a = (uint256(amount) * p2pAgentBps) / BPS;
        uint256 st = (uint256(amount) * stateTurnoverBps) / BPS;
        p2pPaid[orderId] = true;
        _spend(a + st);
        _pay(agent, a);
        _pay(_stateHead(registry.profileOf(agent).stateId), st);
        emit P2PPaid(orderId, agent, a, st);
    }

    // ------------------------------------------------------------ loans: cluster 0.75% + state 1% on opening; agent 2.5% recovery
    function syncLoan(uint256 loanId) external nonReentrant {
        IMicroView.Loan memory l = micro.getLoan(loanId);
        if (l.status == 0) revert NotCompleted();
        if (l.verifier == address(0)) revert NoAgent(); // tier-1 loans have no agent, so no network fee
        JanSetuRegistry.Profile memory ap = registry.profileOf(l.verifier);
        uint256 c; uint256 st; uint256 rec;
        if (!loanOpenPaid[loanId]) {
            c = (uint256(l.principal) * clusterLoanBps) / BPS;
            st = (uint256(l.principal) * stateTurnoverBps) / BPS;
        }
        uint256 basis = recoveryBasis[loanId];
        if (l.paid > basis) rec = ((uint256(l.paid) - basis) * recoveryAgentBps) / BPS;
        if (c + st + rec == 0) revert NothingToPay();
        _spend(c + st + rec);
        if (!loanOpenPaid[loanId]) {
            loanOpenPaid[loanId] = true;
            _pay(_clusterHead(ap.clusterId), c);
            _pay(_stateHead(ap.stateId), st);
            emit LoanOpenPaid(loanId, c, st);
        }
        if (rec > 0) {
            recoveryBasis[loanId] = l.paid;
            _pay(l.verifier, rec);
            emit RecoveryPaid(loanId, l.verifier, rec);
        }
    }

    // ------------------------------------------------------------ prediction fees: districts + DAO
    /// @notice PredictionLP pays its protocol side into this contract. Anyone can split whatever arrived.
    function sweepPrediction() external nonReentrant {
        uint256 tracked = pool + districtOwed;
        uint256 bal = token.balanceOf(address(this));
        if (bal <= tracked) revert NothingToPay();
        uint256 fresh = bal - tracked;
        uint256 toDistricts = (fresh * districtShareBps) / BPS;
        uint256 weight = address(ranks) == address(0) ? 0 : ranks.totalDistrictVolume();
        if (weight == 0) toDistricts = 0; // nobody to share with yet: all to the DAO
        uint256 toDao = fresh - toDistricts;
        if (toDistricts > 0) { accPerVolume += (toDistricts * ACC) / weight; districtOwed += toDistricts; }
        if (toDao > 0) token.safeTransfer(dao, toDao);
        emit PredictionSwept(fresh, toDistricts, toDao);
    }

    /// @notice Called by NetworkRanks before a district's volume changes, and by anyone before paying.
    function checkpointDistrict(uint32 districtId) public {
        if (address(ranks) == address(0)) return;
        uint256 acc = accPerVolume;
        uint256 w = ranks.districtVolume(districtId);
        if (w > 0 && acc > districtPaidAcc[districtId]) districtAccrued[districtId] += (w * (acc - districtPaidAcc[districtId])) / ACC;
        districtPaidAcc[districtId] = acc;
    }

    function districtPending(uint32 districtId) external view returns (uint256) {
        uint256 w = address(ranks) == address(0) ? 0 : ranks.districtVolume(districtId);
        uint256 extra = (w > 0 && accPerVolume > districtPaidAcc[districtId]) ? (w * (accPerVolume - districtPaidAcc[districtId])) / ACC : 0;
        return districtAccrued[districtId] + extra;
    }

    /// @notice Pays a district's accrued prediction share to its head (or the DAO if the seat is empty). Anyone may call.
    function payDistrict(uint32 districtId) external nonReentrant {
        checkpointDistrict(districtId);
        uint256 amt = districtAccrued[districtId];
        if (amt == 0) revert NothingToPay();
        if (amt > districtOwed) amt = districtOwed; // rounding guard
        districtAccrued[districtId] = 0; districtOwed -= amt;
        address to = commissions.districtHead(districtId);
        if (to == address(0)) to = dao;
        token.safeTransfer(to, amt);
        emit DistrictPaid(districtId, to, amt);
    }

    function isSolvent() external view returns (bool) { return token.balanceOf(address(this)) >= pool + districtOwed; }

    // ------------------------------------------------------------ internals
    function _spend(uint256 amount) private { if (pool < amount) revert PoolShort(); pool -= amount; }
    function _pay(address to, uint256 amount) private { if (amount > 0) token.safeTransfer(to, amount); }
    function _clusterHead(uint32 id) private view returns (address h) { h = commissions.clusterHead(id); if (h == address(0)) h = dao; }
    function _stateHead(uint32 id) private view returns (address h) { h = commissions.stateHead(id); if (h == address(0)) h = dao; }
}
