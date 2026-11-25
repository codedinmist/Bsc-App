// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {JanSetuRegistry} from "./JanSetuRegistry.sol";
import {AgentStaking} from "./AgentStaking.sol";

/// @title P2P cash-in / cash-out escrow between a customer and a verified agent.
/// @dev The LOCKER puts tINR in escrow first; the BENEFICIARY then does the off-chain cash step.
///      Cash-in : locker = agent, beneficiary = customer (customer pays cash, receives tINR).
///      Cash-out: locker = customer, beneficiary = agent (agent hands cash, receives tINR).
///      Only the locker can release (directly, or by an EIP-712 signature a relayer/beneficiary submits).
///      A 6-digit code is only a UI aid and is never accepted on-chain.
///      Locker may refund only after the deadline and only if no dispute is open.
///      Disputes: beneficiary opens one; a RESOLVER proposes a result; it becomes final after APPEAL_WINDOW unless
///      the loser appeals, in which case a GOVERNOR decides. Slashing happens only on a final decision against an agent.
///      No role can move escrowed funds anywhere except to the locker or the beneficiary of that order.
contract P2PEscrow is ERC2771Context, AccessControl, ReentrancyGuard, Pausable, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant RESOLVER_ROLE = keccak256("RESOLVER_ROLE");
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    bytes32 private constant RELEASE_TYPEHASH =
        keccak256("Release(uint256 orderId,address locker,address beneficiary,uint256 amount,uint256 deadline)");

    enum Kind { CashIn, CashOut }
    enum Status { None, Open, Released, Refunded, Disputed, ResolvedToLocker, ResolvedToBeneficiary }

    struct Order {
        address locker;
        address beneficiary;
        uint128 amount;
        uint64 createdAt;
        uint64 deadline;
        Kind kind;
        Status status;
    }

    struct Dispute {
        bytes32 evidenceHash;
        bool proposedToBeneficiary;
        uint64 proposedAt;
        bool proposed;
        bool appealed;
    }

    IERC20 public immutable token;
    JanSetuRegistry public immutable registry;
    AgentStaking public immutable staking;
    uint64 public immutable maxWindow;       // deck: 2 hours
    uint64 public immutable appealWindow;    // e.g. 24 hours
    uint256 public immutable minAmount;
    uint256 public immutable maxAmount;
    uint16 public immutable slashBps;        // penalty on an agent who loses, % of order, capped by stake

    uint64 public constant MIN_WINDOW = 5 minutes;

    uint256 public nextOrderId = 1;
    mapping(uint256 => Order) public orders;
    mapping(uint256 => Dispute) public disputes;
    uint256 public totalEscrowed;

    event OrderCreated(uint256 indexed id, Kind kind, address indexed locker, address indexed beneficiary, uint256 amount, uint64 deadline);
    event OrderReleased(uint256 indexed id, address indexed to, uint256 amount, bool bySignature);
    event OrderRefunded(uint256 indexed id, address indexed to, uint256 amount);
    event DisputeOpened(uint256 indexed id, address indexed by, bytes32 evidenceHash);
    event ResolutionProposed(uint256 indexed id, bool toBeneficiary, address indexed by);
    event ResolutionAppealed(uint256 indexed id, address indexed by);
    event DisputeFinalised(uint256 indexed id, bool toBeneficiary, uint256 slashed);

    error BadParam();
    error NotParticipant();
    error NotEligible();
    error BadStatus();
    error TooEarly();
    error Expired();
    error BadSignature();
    error FeeOnTransfer();
    error AmountOutOfRange();
    error NotLoser();
    error AlreadyProposed();
    error NoProposal();
    error AppealWindowOpen();
    error AppealWindowClosed();

    constructor(
        address admin, address forwarder, IERC20 token_, JanSetuRegistry registry_, AgentStaking staking_,
        uint64 maxWindow_, uint64 appealWindow_, uint256 minAmount_, uint256 maxAmount_, uint16 slashBps_
    ) ERC2771Context(forwarder) EIP712("JanSetuP2PEscrow", "1") {
        if (maxWindow_ < MIN_WINDOW || maxWindow_ > 24 hours || appealWindow_ < 1 hours || appealWindow_ > 7 days) revert BadParam();
        if (minAmount_ == 0 || maxAmount_ < minAmount_ || maxAmount_ > type(uint128).max || slashBps_ > 5000) revert BadParam();
        token = token_; registry = registry_; staking = staking_;
        maxWindow = maxWindow_; appealWindow = appealWindow_;
        minAmount = minAmount_; maxAmount = maxAmount_; slashBps = slashBps_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, admin);
    }

    // ---------------- create ----------------
    /// @param counterparty the other side. Locker is the caller.
    function createOrder(Kind kind, address counterparty, uint256 amount, uint64 window) external nonReentrant whenNotPaused returns (uint256 id) {
        address locker = _msgSender();
        if (amount < minAmount || amount > maxAmount) revert AmountOutOfRange();
        if (window < MIN_WINDOW || window > maxWindow || counterparty == locker) revert BadParam();

        address agent = kind == Kind.CashIn ? locker : counterparty;
        address customer = kind == Kind.CashIn ? counterparty : locker;
        if (!registry.isActiveAgent(agent)) revert NotEligible();
        if (!registry.isRegistered(customer) || registry.roleOf(customer) != JanSetuRegistry.Role.Customer) revert NotEligible();
        if (registry.profileOf(customer).suspended) revert NotEligible();

        // Cash-in: the agent holds the customer's cash risk, so their stake must cover the whole order.
        if (kind == Kind.CashIn) staking.reserve(agent, amount);

        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(locker, address(this), amount);
        if (token.balanceOf(address(this)) - before != amount) revert FeeOnTransfer();
        totalEscrowed += amount;

        id = nextOrderId++;
        uint64 deadline = uint64(block.timestamp) + window;
        orders[id] = Order(locker, counterparty, uint128(amount), uint64(block.timestamp), deadline, kind, Status.Open);
        emit OrderCreated(id, kind, locker, counterparty, amount, deadline);
    }

    // ---------------- happy path ----------------
    function release(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        if (o.status != Status.Open) revert BadStatus();
        if (_msgSender() != o.locker) revert NotParticipant();
        _payBeneficiary(id, o, false);
    }

    /// @notice Release using the locker's signature (e.g. the customer confirms in-app, the agent submits it).
    function releaseWithSignature(uint256 id, uint256 sigDeadline, bytes calldata signature) external nonReentrant {
        Order storage o = orders[id];
        if (o.status != Status.Open) revert BadStatus();
        if (block.timestamp > sigDeadline) revert Expired();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(RELEASE_TYPEHASH, id, o.locker, o.beneficiary, uint256(o.amount), sigDeadline)));
        if (!SignatureChecker.isValidSignatureNow(o.locker, digest, signature)) revert BadSignature();
        _payBeneficiary(id, o, true);
    }

    function refund(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        if (o.status != Status.Open) revert BadStatus(); // a disputed order can never be refunded here
        if (_msgSender() != o.locker) revert NotParticipant();
        if (block.timestamp <= o.deadline) revert TooEarly();
        o.status = Status.Refunded;
        _settle(o, o.locker);
        emit OrderRefunded(id, o.locker, o.amount);
    }

    // ---------------- disputes ----------------
    /// @notice Beneficiary says they did their part but the locker is not releasing. Freezes the order.
    function openDispute(uint256 id, bytes32 evidenceHash) external {
        Order storage o = orders[id];
        if (o.status != Status.Open) revert BadStatus();
        if (_msgSender() != o.beneficiary) revert NotParticipant();
        o.status = Status.Disputed;
        disputes[id].evidenceHash = evidenceHash;
        emit DisputeOpened(id, _msgSender(), evidenceHash);
    }

    function proposeResolution(uint256 id, bool toBeneficiary) external onlyRole(RESOLVER_ROLE) {
        Order storage o = orders[id];
        Dispute storage d = disputes[id];
        if (o.status != Status.Disputed) revert BadStatus();
        if (d.proposed) revert AlreadyProposed();
        if (_msgSender() == o.locker || _msgSender() == o.beneficiary) revert NotParticipant();
        d.proposed = true; d.proposedToBeneficiary = toBeneficiary; d.proposedAt = uint64(block.timestamp);
        emit ResolutionProposed(id, toBeneficiary, _msgSender());
    }

    /// @notice The party the proposal went against may appeal once, inside the window.
    function appeal(uint256 id) external {
        Order storage o = orders[id];
        Dispute storage d = disputes[id];
        if (o.status != Status.Disputed || !d.proposed) revert NoProposal();
        if (d.appealed) revert BadStatus();
        if (block.timestamp > d.proposedAt + appealWindow) revert AppealWindowClosed();
        address loser = d.proposedToBeneficiary ? o.locker : o.beneficiary;
        if (_msgSender() != loser) revert NotLoser();
        d.appealed = true;
        emit ResolutionAppealed(id, _msgSender());
    }

    /// @notice Final decision after an appeal (GOVERNOR), or the unappealed proposal once its window has passed (anyone).
    function finalise(uint256 id, bool toBeneficiary) external nonReentrant {
        Order storage o = orders[id];
        Dispute storage d = disputes[id];
        if (o.status != Status.Disputed || !d.proposed) revert NoProposal();
        bool result;
        if (d.appealed) {
            _checkRole(GOVERNOR_ROLE);
            result = toBeneficiary;
        } else {
            if (block.timestamp <= d.proposedAt + appealWindow) revert AppealWindowOpen();
            result = d.proposedToBeneficiary;
        }
        address winner = result ? o.beneficiary : o.locker;
        address loser = result ? o.locker : o.beneficiary;
        o.status = result ? Status.ResolvedToBeneficiary : Status.ResolvedToLocker;
        _settle(o, winner);

        uint256 slashed;
        if (registry.roleOf(loser) == JanSetuRegistry.Role.Agent && slashBps > 0) {
            slashed = staking.slash(loser, (uint256(o.amount) * slashBps) / 10_000, keccak256(abi.encode(id, d.evidenceHash)));
        }
        emit DisputeFinalised(id, result, slashed);
    }

    // ---------------- views ----------------
    function isSolvent() external view returns (bool) { return token.balanceOf(address(this)) >= totalEscrowed; }
    function domainSeparator() external view returns (bytes32) { return _domainSeparatorV4(); }

    // ---------------- internals ----------------
    function _payBeneficiary(uint256 id, Order storage o, bool bySig) private {
        o.status = Status.Released;
        _settle(o, o.beneficiary);
        emit OrderReleased(id, o.beneficiary, o.amount, bySig);
    }

    function _settle(Order storage o, address to) private {
        uint256 amt = o.amount;
        totalEscrowed -= amt;
        if (o.kind == Kind.CashIn) staking.unreserve(o.locker, amt);
        token.safeTransfer(to, amt);
    }

    // ---------------- safety ----------------
    /// @dev Pause blocks NEW orders only. Release, refund, disputes and resolutions always work.
    function pause() external onlyRole(GUARDIAN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) { return ERC2771Context._msgSender(); }
    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) { return ERC2771Context._msgData(); }
    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) { return ERC2771Context._contextSuffixLength(); }
}
