// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {JanSetuRegistry} from "../core/JanSetuRegistry.sol";
import {IVault, IRDView} from "../interfaces/IVault.sol";

/// @title Commission manager (deck slide 7: Agent / Cluster / District / State / DAO shares of every deposit).
/// @dev Permissionless and read-only towards the vaults: anyone calls `sync(vault,id)`, the contract reads the
///      position and accrues commission on principal not yet counted. Rules:
///      - Paid from a FUNDED commission pool. If the pool cannot cover a sync, that principal is not counted (never created from nothing).
///      - Vests linearly from the first sync to the position's maturity. If the position is closed before
///        maturity, unclaimed commission is cancelled and returns to the pool, so deposit-then-withdraw cannot farm it.
///      - Payees are snapshotted at first sync (customer's referrer agent and that agent's cluster/district/state heads).
///        A missing head's share goes to the DAO address.
///      New-account RD boost (deck slide 8): a 3-5 year RD opened within 90 days of the customer joining earns the
///      agent +20% on the agent share (13% becomes 15.6%). It is reserved from the funded pool like everything else.
///      Vesting uses a single schedule per position: later top-ups (daily/RD instalments) vest from the original
///      start, so a top-up vests proportionally faster. The total is always bounded by what was reserved.
contract CommissionManager is AccessControl, ReentrancyGuard, ERC2771Context {
    using SafeERC20 for IERC20;

    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    /// @notice NetworkRanks: may only call setHead, after on-chain thresholds are met (deck slide 7).
    bytes32 public constant RANKS_ROLE = keccak256("RANKS_ROLE");
    uint256 internal constant BPS = 10_000;
    uint256 public constant MONTH = 30 days;

    enum Kind { None, Daily, RD, FD }
    // payee slots
    uint8 internal constant AGENT = 0; uint8 internal constant CLUSTER = 1; uint8 internal constant DISTRICT = 2; uint8 internal constant STATE = 3; uint8 internal constant DAO = 4;

    struct Schedule {
        address vault;
        uint128 basis;      // principal already counted (funded)
        uint64 start;
        uint64 end;
        bool cancelled;
        bool counted;       // already counted towards the agent's monthly account tally
        bool boosted;       // new-account 3-5 year RD: agent share +boostBps
        address[5] payee;
        uint128[5] claimed;
    }

    IERC20 public immutable token;
    JanSetuRegistry public immutable registry;
    address public immutable dao;

    mapping(address => Kind) public vaultKind;
    mapping(Kind => uint16[5]) public rateBps; // deck table, in bps of deposit
    mapping(address => address) public referrerOf;
    mapping(address => address[]) private _referrals;   // agent => customers who chose them
    uint16 public boostBps = 2000;          // +20% of the agent share
    uint64 public boostWindow = 90 days;    // from the customer's registration
    uint16 public boostMinMonths = 36; uint16 public boostMaxMonths = 60;
    mapping(uint32 => address) public clusterHead;
    mapping(uint32 => address) public districtHead;
    mapping(uint32 => address) public stateHead;

    mapping(bytes32 => Schedule) private _s; // key = keccak(vault,id)
    mapping(address => uint256) public agentVolume;                         // cumulative counted principal of referred customers
    mapping(address => mapping(uint256 => uint256)) public monthAccounts;   // agent => month => accounts first counted

    uint256 public minAccountPrincipal = 5_000e18; // a deposit only counts as an "account" for the monthly booster above this size (anti-farming)
    uint256 public pool;          // free, unreserved commission funds
    uint256 public liability;     // reserved for schedules

    event Funded(address indexed from, uint256 amount);
    event ReferrerSet(address indexed customer, address indexed agent);
    event Synced(address indexed vault, uint256 indexed id, uint256 counted, uint256 skippedUnfunded);
    event Claimed(address indexed vault, uint256 indexed id, uint8 slot, address indexed payee, uint256 amount);
    event Cancelled(address indexed vault, uint256 indexed id, uint256 returned);
    event HeadSet(uint8 level, uint32 areaId, address head);
    event BoostSet(uint16 bps, uint64 window, uint16 minMonths, uint16 maxMonths);

    error NotAgent();
    error AlreadyReferred();
    error NotRegistered();
    error UnknownVault();
    error NothingToSync();
    error Cancelled_();
    error NothingToClaim();
    error SelfReferral();

    constructor(address admin, IERC20 token_, JanSetuRegistry registry_, address dao_, address forwarder) ERC2771Context(forwarder) {
        token = token_; registry = registry_; dao = dao_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GOVERNOR_ROLE, admin);
        rateBps[Kind.Daily] = [800, 175, 100, 75, 50];
        rateBps[Kind.RD]    = [1300, 300, 200, 125, 75];
        rateBps[Kind.FD]    = [950, 225, 150, 100, 75];
    }

    // ------------------------------------------------------------- governance
    function setVault(address vault, Kind kind) external onlyRole(GOVERNOR_ROLE) { vaultKind[vault] = kind; }

    function setHead(uint8 level, uint32 areaId, address head) external {
        if (!hasRole(GOVERNOR_ROLE, msg.sender) && !hasRole(RANKS_ROLE, msg.sender)) revert AccessControlUnauthorizedAccount(msg.sender, GOVERNOR_ROLE);
        require(level >= 1 && level <= 3, "level");
        if (level == 1) clusterHead[areaId] = head; else if (level == 2) districtHead[areaId] = head; else stateHead[areaId] = head;
        emit HeadSet(level, areaId, head);
    }

    function setBoost(uint16 bps, uint64 window, uint16 minMonths, uint16 maxMonths) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(bps <= 5000 && window <= 365 days && minMonths <= maxMonths, "bounds");
        boostBps = bps; boostWindow = window; boostMinMonths = minMonths; boostMaxMonths = maxMonths;
        emit BoostSet(bps, window, minMonths, maxMonths);
    }

    /// @notice Rates are bounded so the total can never exceed 30% of a deposit.
    function setMinAccountPrincipal(uint256 v) external onlyRole(DEFAULT_ADMIN_ROLE) { require(v <= 1_000_000e18, "bounds"); minAccountPrincipal = v; }

    function setRates(Kind kind, uint16[5] calldata r) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 sum; for (uint256 i; i < 5; ++i) sum += r[i];
        require(sum <= 3000, "total over 30%");
        rateBps[kind] = r;
    }

    function fund(uint256 amount) external nonReentrant {
        uint256 b = token.balanceOf(address(this));
        token.safeTransferFrom(_msgSender(), address(this), amount);
        require(token.balanceOf(address(this)) - b == amount, "fee on transfer");
        pool += amount;
        emit Funded(_msgSender(), amount);
    }

    // ------------------------------------------------------------- customers
    /// @notice A customer chooses their agent once. Agents cannot refer themselves.
    function setReferrer(address agent) external {
        if (!registry.isRegistered(_msgSender())) revert NotRegistered();
        if (referrerOf[_msgSender()] != address(0)) revert AlreadyReferred();
        if (agent == _msgSender()) revert SelfReferral();
        // The agent may still be waiting for verification (the 2-referral rule needs referrals first); commission is only
        // paid once the agent is verified at the first sync.
        if (!registry.isAgentCandidate(agent)) revert NotAgent();
        referrerOf[_msgSender()] = agent;
        _referrals[agent].push(_msgSender());
        emit ReferrerSet(_msgSender(), agent);
    }

    // ------------------------------------------------------------- accrual
    function sync(address vault, uint256 id) external nonReentrant {
        Kind kind = vaultKind[vault];
        if (kind == Kind.None) revert UnknownVault();
        IVault.Position memory p = IVault(vault).getPosition(id);
        bytes32 key = keccak256(abi.encode(vault, id));
        Schedule storage s = _s[key];
        if (s.cancelled) revert Cancelled_();
        if (p.status != IVault.Status.Active) revert NothingToSync();

        uint256 delta = uint256(p.principal) > s.basis ? uint256(p.principal) - s.basis : 0;
        if (delta == 0) revert NothingToSync();

        if (s.vault == address(0)) {
            address agent = referrerOf[p.owner];
            if (agent == address(0)) revert NotAgent();
            if (!registry.isActiveAgent(agent)) revert NotAgent();
            JanSetuRegistry.Profile memory prof = registry.profileOf(agent);
            if (kind == Kind.RD && boostBps > 0) {
                (, uint16 months,,,,,,,,) = IRDView(vault).accounts(id);
                uint64 joined = registry.profileOf(p.owner).registeredAt;
                if (months >= boostMinMonths && months <= boostMaxMonths && p.openedAt <= uint256(joined) + boostWindow) s.boosted = true;
            }
            s.vault = vault; s.start = uint64(block.timestamp); s.end = p.maturityAt;
            s.payee[AGENT] = agent;
            s.payee[CLUSTER] = _or(clusterHead[prof.clusterId]);
            s.payee[DISTRICT] = _or(districtHead[prof.districtId]);
            s.payee[STATE] = _or(stateHead[prof.stateId]);
            s.payee[DAO] = dao;
        }

        uint256 need = (delta * _sumEff(s, kind)) / BPS;
        if (pool < need) { emit Synced(vault, id, 0, delta); return; }
        pool -= need; liability += need;
        s.basis += uint128(delta);
        agentVolume[s.payee[AGENT]] += delta;
        if (!s.counted && s.basis >= minAccountPrincipal) { s.counted = true; monthAccounts[s.payee[AGENT]][block.timestamp / MONTH] += 1; }
        emit Synced(vault, id, delta, 0);
    }

    function _or(address a) private view returns (address) { return a == address(0) ? dao : a; }
    /// @dev Effective bps for one slot: the agent slot carries the new-account boost when the schedule is boosted.
    function _eff(Schedule storage s, Kind kind, uint8 slot) private view returns (uint256) {
        uint256 r = rateBps[kind][slot];
        return (slot == AGENT && s.boosted) ? (r * (BPS + boostBps)) / BPS : r;
    }
    function _sumEff(Schedule storage s, Kind kind) private view returns (uint256 t) { for (uint8 i; i < 5; ++i) t += _eff(s, kind, i); }

    // ------------------------------------------------------------- payouts
    /// @notice Pay the vested part to one payee slot. Early-closed positions are cancelled instead.
    function claim(address vault, uint256 id, uint8 slot) external nonReentrant {
        bytes32 key = keccak256(abi.encode(vault, id));
        Schedule storage s = _s[key];
        if (s.vault == address(0)) revert NothingToSync();
        if (s.cancelled) revert Cancelled_();
        IVault.Position memory p = IVault(vault).getPosition(id);
        if (p.status == IVault.Status.Closed && block.timestamp < s.end) { _cancel(vault, id, s); return; }

        uint256 due = _vested(s, slot, vaultKind[vault]) - s.claimed[slot];
        if (due == 0) revert NothingToClaim();
        s.claimed[slot] += uint128(due);
        liability -= due;
        token.safeTransfer(s.payee[slot], due);
        emit Claimed(vault, id, slot, s.payee[slot], due);
    }

    /// @notice Anyone may cancel a schedule whose position closed early.
    function cancelIfClosedEarly(address vault, uint256 id) external nonReentrant {
        Schedule storage s = _s[keccak256(abi.encode(vault, id))];
        if (s.vault == address(0) || s.cancelled) revert Cancelled_();
        IVault.Position memory p = IVault(vault).getPosition(id);
        if (!(p.status == IVault.Status.Closed && block.timestamp < s.end)) revert NothingToClaim();
        _cancel(vault, id, s);
    }

    function _cancel(address vault, uint256 id, Schedule storage s) private {
        Kind kind = vaultKind[vault];
        uint256 unclaimed;
        for (uint8 i; i < 5; ++i) unclaimed += _full(s, i, kind) - s.claimed[i];
        s.cancelled = true;
        liability -= unclaimed; pool += unclaimed;
        emit Cancelled(vault, id, unclaimed);
    }

    function _full(Schedule storage s, uint8 slot, Kind kind) private view returns (uint256) { return (uint256(s.basis) * _eff(s, kind, slot)) / BPS; }

    function _vested(Schedule storage s, uint8 slot, Kind kind) private view returns (uint256) {
        uint256 full = _full(s, slot, kind);
        if (block.timestamp >= s.end) return full;
        if (s.end <= s.start) return full;
        return (full * (block.timestamp - s.start)) / (s.end - s.start);
    }

    // ------------------------------------------------------------- views
    function scheduleOf(address vault, uint256 id) external view returns (address[5] memory payee, uint128[5] memory claimed, uint128 basis, uint64 start, uint64 end, bool cancelled) {
        Schedule storage s = _s[keccak256(abi.encode(vault, id))];
        return (s.payee, s.claimed, s.basis, s.start, s.end, s.cancelled);
    }

    function isBoosted(address vault, uint256 id) external view returns (bool) { return _s[keccak256(abi.encode(vault, id))].boosted; }
    function referralCount(address agent) external view returns (uint256) { return _referrals[agent].length; }
    function referralAt(address agent, uint256 i) external view returns (address) { return _referrals[agent][i]; }

    function claimable(address vault, uint256 id, uint8 slot) external view returns (uint256) {
        Schedule storage s = _s[keccak256(abi.encode(vault, id))];
        if (s.vault == address(0) || s.cancelled) return 0;
        return _vested(s, slot, vaultKind[vault]) - s.claimed[slot];
    }

    function isSolvent() external view returns (bool) { return token.balanceOf(address(this)) >= pool + liability; }

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) { return ERC2771Context._msgSender(); }
    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) { return ERC2771Context._msgData(); }
    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) { return ERC2771Context._contextSuffixLength(); }
}
