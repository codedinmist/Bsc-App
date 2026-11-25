// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {ProtocolConfig} from "../core/ProtocolConfig.sol";
import {JanSetuRegistry} from "../core/JanSetuRegistry.sol";
import {DigitalReceiptNFT} from "../core/DigitalReceiptNFT.sol";
import {ConfigKeys} from "../libraries/ConfigKeys.sol";

/// @title Shared accounting for the savings vaults.
/// @dev ACCOUNTING MODEL (invariant): token.balanceOf(this) >= totalPrincipal + rewardPool + totalRewardLiability
///   - totalPrincipal       : sum of customers' principal. Never lent out, never used for rewards.
///   - rewardPool           : funded, still unreserved reward money (anyone can fund; nobody can withdraw it).
///   - totalRewardLiability : reward money reserved for specific positions.
///   Rewards are reserved only if the pool can cover them; otherwise they are recorded as UNFUNDED and are
///   never paid out of principal. There is no admin withdrawal function.
abstract contract VaultBase is ERC2771Context, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    /// @dev Contracts (CollateralLoan) that customers may pledge collateral to. A pledgee can only touch
    ///      amounts the OWNER pledged to it.
    bytes32 public constant COLLATERAL_ROLE = keccak256("COLLATERAL_ROLE");
    uint256 internal constant BPS = 10_000;

    enum Status { None, Active, Closed }

    struct Position {
        address owner;
        uint128 principal;
        uint128 locked;          // pledged as loan collateral
        uint128 rewardReserved;  // funded, will be paid at maturity
        uint128 rewardUnfunded;  // promised by parameters but NOT backed by the pool (never paid)
        uint64 openedAt;
        uint64 maturityAt;
        bool collateralEligible;
        Status status;
    }

    IERC20 public immutable token;
    ProtocolConfig public immutable config;
    JanSetuRegistry public immutable registry;
    DigitalReceiptNFT public immutable receipts;

    uint256 public nextPositionId = 1;
    uint256 public totalPrincipal;
    uint256 public rewardPool;
    uint256 public totalRewardLiability;

    mapping(uint256 => Position) internal _pos;
    mapping(address => uint256[]) internal _idsOf;
    mapping(uint256 => mapping(address => uint128)) public pledgedTo;

    event PositionOpened(uint256 indexed id, address indexed owner, uint64 maturityAt);
    event RewardsFunded(address indexed funder, uint256 amount);
    event RewardReserved(uint256 indexed id, uint256 funded, uint256 unfunded);
    event PositionSettled(uint256 indexed id, address indexed owner, uint256 principalPaid, uint256 penalty, uint256 rewardPaid, bool matured);
    event ReceiptLinked(uint256 indexed receiptId, uint256 indexed positionId);
    event Pledged(uint256 indexed id, address indexed pledgee, uint256 amount);
    event Released(uint256 indexed id, address indexed pledgee, uint256 amount);
    event Seized(uint256 indexed id, address indexed pledgee, address indexed to, uint256 amount);

    error NotOwner();
    error NotActive();
    error NotRegistered();
    error KycRequired();
    error UnsupportedToken();
    error CollateralLocked();
    error NotMatured();
    error AlreadyMatured();
    error TooEarly();
    error ZeroAmount();
    error NotEligibleForCollateral();
    error InsufficientUnlocked();
    error NotPledgee();
    error InvalidPledgee();

    constructor(address admin, address forwarder, IERC20 token_, ProtocolConfig config_, JanSetuRegistry registry_, DigitalReceiptNFT receipts_)
        ERC2771Context(forwarder)
    {
        token = token_;
        config = config_;
        registry = registry_;
        receipts = receipts_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    // ------------------------------------------------------------------ public
    /// @notice Anyone may add money to the funded reward pool. Contributions cannot be withdrawn by anyone.
    function fundRewards(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _pull(_msgSender(), amount);
        rewardPool += amount;
        emit RewardsFunded(_msgSender(), amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    /// @notice Owner pledges part of the position to a registered collateral contract.
    function pledge(uint256 id, uint256 amount, address pledgee) external whenNotPaused nonReentrant {
        Position storage p = _pos[id];
        if (p.owner != _msgSender()) revert NotOwner();
        if (p.status != Status.Active) revert NotActive();
        if (!p.collateralEligible) revert NotEligibleForCollateral();
        if (!hasRole(COLLATERAL_ROLE, pledgee)) revert InvalidPledgee();
        if (amount == 0) revert ZeroAmount();
        if (uint256(p.principal) - p.locked < amount) revert InsufficientUnlocked();
        p.locked += uint128(amount);
        pledgedTo[id][pledgee] += uint128(amount);
        emit Pledged(id, pledgee, amount);
    }

    /// @notice Pledgee frees collateral after the loan is repaid. Works even while paused.
    function release(uint256 id, uint256 amount) external nonReentrant {
        _decreasePledge(id, msg.sender, amount);
        emit Released(id, msg.sender, amount);
    }

    /// @notice Pledgee seizes pledged principal after a default. Only up to what the owner pledged to it.
    function seize(uint256 id, uint256 amount, address to) external nonReentrant {
        _decreasePledge(id, msg.sender, amount);
        Position storage p = _pos[id];
        p.principal -= uint128(amount);
        totalPrincipal -= amount;
        emit Seized(id, msg.sender, to, amount);
        token.safeTransfer(to, amount);
    }

    // ------------------------------------------------------------------ views
    function getPosition(uint256 id) external view returns (Position memory) { return _pos[id]; }
    function idsOf(address owner) external view returns (uint256[] memory) { return _idsOf[owner]; }

    /// @notice Principal that can still be pledged or withdrawn.
    function unlockedPrincipal(uint256 id) external view returns (uint256) {
        Position storage p = _pos[id];
        return p.status == Status.Active ? uint256(p.principal) - p.locked : 0;
    }

    /// @notice Core solvency check: real token balance covers every recorded liability.
    function isSolvent() external view returns (bool) {
        return token.balanceOf(address(this)) >= totalPrincipal + rewardPool + totalRewardLiability;
    }

    // ------------------------------------------------------------------ internals
    function _requireEligible(address who) internal view {
        if (!registry.isRegistered(who)) revert NotRegistered();
        if (config.getUint(ConfigKeys.REQUIRE_KYC) == 1 && !registry.isKyc(who)) revert KycRequired();
    }

    function _create(address owner, uint64 maturityAt, bool eligible) internal returns (uint256 id) {
        id = nextPositionId++;
        _pos[id] = Position(owner, 0, 0, 0, 0, uint64(block.timestamp), maturityAt, eligible, Status.Active);
        _idsOf[owner].push(id);
        emit PositionOpened(id, owner, maturityAt);
    }

    function _pull(address from, uint256 amount) internal {
        uint256 beforeBal = token.balanceOf(address(this));
        token.safeTransferFrom(from, address(this), amount);
        if (token.balanceOf(address(this)) - beforeBal != amount) revert UnsupportedToken(); // fee-on-transfer etc.
    }

    function _credit(uint256 id, uint256 amount) internal {
        _pos[id].principal += uint128(amount);
        totalPrincipal += amount;
    }

    /// @dev Reserve `reward` from the pool for this position if (and only if) the pool can cover it.
    function _reserve(uint256 id, uint256 reward) internal returns (bool funded) {
        if (reward == 0) return true;
        Position storage p = _pos[id];
        if (rewardPool >= reward) {
            rewardPool -= reward;
            totalRewardLiability += reward;
            p.rewardReserved += uint128(reward);
            emit RewardReserved(id, reward, 0);
            return true;
        }
        p.rewardUnfunded += uint128(reward);
        emit RewardReserved(id, 0, reward);
        return false;
    }

    /// @dev Take an amount straight from the free pool (used for bonuses paid immediately). Returns 0 if unfunded.
    function _takeFromPool(uint256 amount) internal returns (uint256) {
        if (amount == 0 || rewardPool < amount) return 0;
        rewardPool -= amount;
        return amount;
    }

    /// @dev Closes a position. `penalty` stays in the vault and replenishes the reward pool.
    function _settle(uint256 id, uint256 penalty, bool payReward, uint256 bonus, bool matured) internal {
        Position storage p = _pos[id];
        if (p.status != Status.Active) revert NotActive();
        if (p.locked != 0) revert CollateralLocked();

        address owner = p.owner;
        uint256 principal = p.principal;
        uint256 reserved = p.rewardReserved;
        uint256 rewardPaid = payReward ? reserved + bonus : 0;
        if (!payReward && bonus > 0) rewardPool += bonus; // bonus not payable: return to pool

        // effects
        totalPrincipal -= principal;
        totalRewardLiability -= reserved;
        if (!payReward) rewardPool += reserved;
        rewardPool += penalty;
        p.principal = 0;
        p.rewardReserved = 0;
        p.status = Status.Closed;

        uint256 out = principal - penalty + rewardPaid;
        emit PositionSettled(id, owner, principal - penalty, penalty, rewardPaid, matured);
        // interaction
        token.safeTransfer(owner, out);
    }

    function _receipt(address to, DigitalReceiptNFT.Kind kind, bytes32 flagKey, uint256 refId, uint256 amount) internal {
        if (config.getUint(flagKey) == 1) {
            uint256 receiptId = receipts.issue(to, kind, refId, amount);
            emit ReceiptLinked(receiptId, refId);
        }
    }

    function _decreasePledge(uint256 id, address pledgee, uint256 amount) private {
        uint128 pledged = pledgedTo[id][pledgee];
        if (pledged < amount || amount == 0) revert NotPledgee();
        pledgedTo[id][pledgee] = pledged - uint128(amount);
        _pos[id].locked -= uint128(amount);
    }

    function _requireOwner(uint256 id) internal view returns (Position storage p) {
        p = _pos[id];
        if (p.owner != _msgSender()) revert NotOwner();
        if (p.status != Status.Active) revert NotActive();
    }

    // ------------------------------------------------------------------ ERC-2771 plumbing
    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}
