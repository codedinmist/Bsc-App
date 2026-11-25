// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {JanSetuRegistry} from "../core/JanSetuRegistry.sol";
import {AgentStaking} from "../core/AgentStaking.sol";
import {DigitalReceiptNFT} from "../core/DigitalReceiptNFT.sol";
import {IVault, IDailyView} from "../interfaces/IVault.sol";
import {ILoanPool, ICreditScore} from "../interfaces/ILoanPool.sol";

/// @title Vyapar merchant loans (deck slide 5).
/// @dev Tier 0: 15 daily deposits of >=100 tINR + verification by a staked, active agent -> 10,000 loan, repay 100 x 120.
///      Tier 1: score >= `minScore` and a past completed loan -> 50,000 loan, no agent needed, repay 200 x 300.
///      Money comes only from LoanLiquidityPool (funded by lenders), never from savings vaults.
///      Missed repayments hurt the credit score; after `defaultAfter` days past due anyone can mark a default,
///      which writes the unpaid principal off against the pool. Repayment always works, even when paused.
contract MicroCredit is AccessControl, Pausable, ReentrancyGuard, ERC2771Context {
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant RELIEF_ROLE = keccak256("RELIEF_ROLE"); // InsurancePool: 30-day EMI relief

    enum Status { None, Active, Completed, Defaulted }
    struct Loan {
        address borrower; address verifier;
        uint128 principal; uint128 totalDue; uint128 installment; uint128 paid; uint128 principalRepaid;
        uint32 count; uint32 paidCount; uint64 nextDue; uint8 tier; bool reliefUsed; Status status;
    }

    IERC20 public immutable token;
    JanSetuRegistry public immutable registry;
    AgentStaking public immutable staking;
    ILoanPool public immutable pool;
    ICreditScore public immutable score;
    IVault public immutable dailyVault;
    DigitalReceiptNFT public immutable receipts;

    uint256 public nextLoanId = 1;
    mapping(uint256 => Loan) private _loans;
    mapping(address => uint256) public activeLoanOf;
    mapping(address => uint256) public completedCount;
    mapping(address => bool) public hasDefaulted;
    mapping(address => address) public verifiedBy;           // applicant => agent
    mapping(address => uint64) public verifiedAt;
    mapping(uint256 => bool) public positionUsed;            // a daily position can back only one loan
    uint64 public constant VERIFY_TTL = 14 days;

    // parameters (admin = timelock). Bounded in setters.
    uint256 public tier0Principal = 10_000e18; uint32 public tier0Count = 120; uint256 public tier0Installment = 100e18;
    uint256 public tier1Principal = 50_000e18; uint32 public tier1Count = 300; uint256 public tier1Installment = 200e18;
    uint256 public minDailyInstallment = 100e18; uint16 public minDailyPaid = 15;
    uint256 public minScore = 650;
    uint64 public grace = 1 days; uint64 public defaultAfter = 14 days;
    /// @notice Deck slide 7: customers need KYC. When on, a loan needs a KYC-verified borrower. Off by default; deployment turns it on.
    bool public requireKyc;
    event KycRequirementSet(bool on);

    event Verified(address indexed applicant, address indexed agent);
    event LoanOpened(uint256 indexed id, address indexed borrower, uint8 tier, uint256 principal, uint256 totalDue);
    event Repayment(uint256 indexed id, address indexed payer, uint32 installments, uint256 amount, bool onTime);
    event LoanCompleted(uint256 indexed id, address indexed borrower);
    event LoanDefaulted(uint256 indexed id, address indexed borrower, uint256 writtenOff);
    event ReliefGranted(uint256 indexed id, uint64 newDue);

    error KycRequired(); error NotAgent(); error AgentNotStaked(); error NotVerified(); error HasLoan(); error Defaulted(); error BadPosition(); error NotEligible(); error NotActive(); error NotYetDefault(); error TooMany();

    constructor(address admin, IERC20 token_, JanSetuRegistry registry_, AgentStaking staking_, ILoanPool pool_, ICreditScore score_, IVault dailyVault_, DigitalReceiptNFT receipts_, address forwarder) ERC2771Context(forwarder) {
        token = token_; registry = registry_; staking = staking_; pool = pool_; score = score_; dailyVault = dailyVault_; receipts = receipts_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin); _grantRole(PAUSER_ROLE, admin);
        token_.forceApprove(address(pool_), type(uint256).max);
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    function setRequireKyc(bool on) external onlyRole(DEFAULT_ADMIN_ROLE) { requireKyc = on; emit KycRequirementSet(on); }

    function setTerms(uint256 p0, uint32 c0, uint256 p1, uint32 c1, uint256 minScore_, uint64 grace_, uint64 defaultAfter_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(c0 > 0 && c1 > 0 && c0 <= 400 && c1 <= 400 && p0 <= 100_000e18 && p1 <= 200_000e18 && minScore_ >= 500 && minScore_ <= 900 && grace_ <= 7 days && defaultAfter_ >= 3 days && defaultAfter_ <= 60 days, "bounds");
        tier0Principal = p0; tier0Count = c0; tier0Installment = (p0 * 12 / 10) / c0;
        tier1Principal = p1; tier1Count = c1; tier1Installment = (p1 * 12 / 10) / c1;
        minScore = minScore_; grace = grace_; defaultAfter = defaultAfter_;
    }

    /// @notice An active, staked agent confirms they know this applicant (in-person check happens off-chain).
    function verifyApplicant(address applicant) external {
        if (!registry.isActiveAgent(_msgSender())) revert NotAgent();
        if (!staking.isEligible(_msgSender())) revert AgentNotStaked();
        if (!registry.isRegistered(applicant) || applicant == _msgSender()) revert NotEligible();
        verifiedBy[applicant] = _msgSender(); verifiedAt[applicant] = uint64(block.timestamp);
        emit Verified(applicant, _msgSender());
    }

    function borrow(uint8 tier, uint256 dailyPositionId) external nonReentrant whenNotPaused returns (uint256 id) {
        address b = _msgSender();
        if (requireKyc && !registry.isKyc(b)) revert KycRequired();
        if (activeLoanOf[b] != 0) revert HasLoan();
        if (hasDefaulted[b]) revert Defaulted();
        uint256 principal; uint32 count; uint256 inst; address verifier;

        if (tier == 0) {
            if (verifiedBy[b] == address(0) || block.timestamp > uint256(verifiedAt[b]) + VERIFY_TTL) revert NotVerified();
            verifier = verifiedBy[b];
            IVault.Position memory p = dailyVault.getPosition(dailyPositionId);
            (uint128 installment,, uint16 paidCount,,,) = IDailyView(address(dailyVault)).accounts(dailyPositionId);
            if (p.owner != b || p.status != IVault.Status.Active || positionUsed[dailyPositionId] || installment < minDailyInstallment || paidCount < minDailyPaid) revert BadPosition();
            positionUsed[dailyPositionId] = true;
            (principal, count, inst) = (tier0Principal, tier0Count, tier0Installment);
        } else if (tier == 1) {
            if (completedCount[b] == 0 || score.scoreOf(b) < minScore) revert NotEligible();
            (principal, count, inst) = (tier1Principal, tier1Count, tier1Installment);
        } else revert NotEligible();

        id = nextLoanId++;
        uint256 totalDue = inst * count;
        _loans[id] = Loan(b, verifier, uint128(principal), uint128(totalDue), uint128(inst), 0, 0, count, 0, uint64(block.timestamp + 1 days), tier, false, Status.Active);
        activeLoanOf[b] = id;
        pool.lend(b, principal);
        emit LoanOpened(id, b, tier, principal, totalDue);
    }

    /// @notice Pay `n` installments (anyone may pay on the borrower's behalf). Works while paused.
    function repay(uint256 id, uint32 n) external nonReentrant {
        Loan storage l = _loans[id];
        if (l.status != Status.Active) revert NotActive();
        if (n == 0 || n > l.count - l.paidCount) revert TooMany();
        bool onTime = block.timestamp <= uint256(l.nextDue) + grace;
        uint256 amount = uint256(l.installment) * n;
        uint256 prin = (amount * l.principal) / l.totalDue;
        if (l.paidCount + n == l.count) { amount = l.totalDue - l.paid; prin = l.principal - l.principalRepaid; } // exact finish, no dust
        l.paid += uint128(amount); l.principalRepaid += uint128(prin); l.paidCount += n; l.nextDue += uint64(uint256(n) * 1 days);

        token.safeTransferFrom(_msgSender(), address(this), amount);
        pool.repay(prin, amount - prin);
        emit Repayment(id, _msgSender(), n, amount, onTime);

        if (onTime) score.recordOnTime(l.borrower); else score.recordLate(l.borrower);
        if (l.paidCount == l.count) {
            l.status = Status.Completed; activeLoanOf[l.borrower] = 0; completedCount[l.borrower]++;
            score.recordCompleted(l.borrower);
            try receipts.issue(l.borrower, DigitalReceiptNFT.Kind.LoanCompletion, id, l.principal) {} catch {}
            emit LoanCompleted(id, l.borrower);
        }
    }

    function markDefault(uint256 id) external nonReentrant {
        Loan storage l = _loans[id];
        if (l.status != Status.Active) revert NotActive();
        if (block.timestamp <= uint256(l.nextDue) + defaultAfter) revert NotYetDefault();
        l.status = Status.Defaulted; activeLoanOf[l.borrower] = 0; hasDefaulted[l.borrower] = true;
        uint256 loss = l.principal - l.principalRepaid;
        pool.writeOff(loss);
        score.recordDefault(l.borrower);
        emit LoanDefaulted(id, l.borrower, loss);
    }

    /// @notice Insurance relief: pushes the next due date back 30 days, once per loan.
    function grantRelief(uint256 id) external onlyRole(RELIEF_ROLE) {
        Loan storage l = _loans[id];
        if (l.status != Status.Active || l.reliefUsed) revert NotActive();
        l.reliefUsed = true; l.nextDue += 30 days;
        emit ReliefGranted(id, l.nextDue);
    }

    function getLoan(uint256 id) external view returns (Loan memory) { return _loans[id]; }
    function getLoanBorrower(uint256 id) external view returns (address) { return _loans[id].borrower; }

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) { return ERC2771Context._msgSender(); }
    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) { return ERC2771Context._msgData(); }
    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) { return ERC2771Context._contextSuffixLength(); }
}
