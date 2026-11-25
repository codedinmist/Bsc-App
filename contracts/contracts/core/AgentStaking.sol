// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title Agent stake. Backs every open cash-in exposure so a dishonest agent can be made to pay.
/// @dev Invariants: token.balanceOf(this) >= sum of all stakes + pending unstakes.
///      An agent can never unstake below what escrow has reserved. Slashing is callable only by SLASHER_ROLE
///      (the escrow, which only slashes after a dispute decision survived its appeal window).
///      Pause blocks new stake only; unstake requests and withdrawals always work.
contract AgentStaking is ERC2771Context, AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant RESERVER_ROLE = keccak256("RESERVER_ROLE"); // escrow
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");   // escrow
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    IERC20 public immutable token;
    uint256 public immutable minStake;       // deck: 25,000 tINR for eligibility
    uint64 public immutable unstakeDelay;    // seconds
    address public immutable slashSink;      // treasury

    struct Account {
        uint256 staked;      // active stake (includes reserved)
        uint256 reserved;    // locked by open escrow orders
        uint256 pending;     // requested unstake, waiting out the delay
        uint64 unlockAt;
    }

    mapping(address => Account) public accounts;
    uint256 public totalHeld; // staked + pending across all accounts

    event Staked(address indexed agent, uint256 amount, uint256 newStake);
    event UnstakeRequested(address indexed agent, uint256 amount, uint64 unlockAt);
    event Withdrawn(address indexed agent, uint256 amount);
    event Reserved(address indexed agent, uint256 amount, uint256 totalReserved);
    event Released(address indexed agent, uint256 amount, uint256 totalReserved);
    event Slashed(address indexed agent, uint256 amount, address indexed sink, bytes32 reasonHash);

    error ZeroAmount();
    error InsufficientFreeStake();
    error NotUnlocked();
    error NothingPending();
    error FeeOnTransfer();
    error BadParam();

    constructor(address admin, address forwarder, IERC20 token_, uint256 minStake_, uint64 unstakeDelay_, address slashSink_)
        ERC2771Context(forwarder)
    {
        if (address(token_) == address(0) || slashSink_ == address(0) || unstakeDelay_ < 1 days || unstakeDelay_ > 30 days) revert BadParam();
        token = token_;
        minStake = minStake_;
        unstakeDelay = unstakeDelay_;
        slashSink = slashSink_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, admin);
    }

    // ---------------- agent actions ----------------
    function stake(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        address who = _msgSender();
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(who, address(this), amount);
        if (token.balanceOf(address(this)) - before != amount) revert FeeOnTransfer();
        accounts[who].staked += amount;
        totalHeld += amount;
        emit Staked(who, amount, accounts[who].staked);
    }

    /// @notice Start unstaking `amount` of stake that is not reserved. Funds leave the active stake immediately
    ///         (so they stop counting for eligibility) and can be withdrawn after the delay.
    function requestUnstake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        address who = _msgSender();
        Account storage a = accounts[who];
        if (amount > a.staked - a.reserved) revert InsufficientFreeStake();
        a.staked -= amount;
        a.pending += amount;
        a.unlockAt = uint64(block.timestamp) + unstakeDelay; // every request restarts the clock
        emit UnstakeRequested(who, amount, a.unlockAt);
    }

    function withdraw() external nonReentrant {
        address who = _msgSender();
        Account storage a = accounts[who];
        uint256 amt = a.pending;
        if (amt == 0) revert NothingPending();
        if (block.timestamp < a.unlockAt) revert NotUnlocked();
        a.pending = 0;
        totalHeld -= amt;
        token.safeTransfer(who, amt);
        emit Withdrawn(who, amt);
    }

    // ---------------- escrow hooks ----------------
    function reserve(address agent, uint256 amount) external onlyRole(RESERVER_ROLE) {
        Account storage a = accounts[agent];
        if (amount > a.staked - a.reserved) revert InsufficientFreeStake();
        a.reserved += amount;
        emit Reserved(agent, amount, a.reserved);
    }

    function unreserve(address agent, uint256 amount) external onlyRole(RESERVER_ROLE) {
        Account storage a = accounts[agent];
        // Saturating: a slash may already have clamped `reserved`, and a settlement must never be blocked by that.
        a.reserved = amount > a.reserved ? 0 : a.reserved - amount;
        emit Released(agent, amount, a.reserved);
    }

    /// @notice Burn-to-treasury penalty. Takes from active stake only (never pending: those are already leaving).
    ///         Returns the amount actually slashed (capped by stake).
    function slash(address agent, uint256 amount, bytes32 reasonHash) external onlyRole(SLASHER_ROLE) nonReentrant returns (uint256 taken) {
        Account storage a = accounts[agent];
        taken = amount > a.staked ? a.staked : amount;
        if (taken == 0) return 0;
        a.staked -= taken;
        if (a.reserved > a.staked) a.reserved = a.staked; // never leave reservation above stake
        totalHeld -= taken;
        token.safeTransfer(slashSink, taken);
        emit Slashed(agent, taken, slashSink, reasonHash);
    }

    // ---------------- views ----------------
    function freeStake(address agent) external view returns (uint256) {
        Account storage a = accounts[agent];
        return a.staked - a.reserved;
    }

    function isEligible(address agent) external view returns (bool) {
        return accounts[agent].staked >= minStake;
    }

    function isSolvent() external view returns (bool) {
        return token.balanceOf(address(this)) >= totalHeld;
    }

    // ---------------- safety ----------------
    function pause() external onlyRole(GUARDIAN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) { return ERC2771Context._msgSender(); }
    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) { return ERC2771Context._msgData(); }
    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) { return ERC2771Context._contextSuffixLength(); }
}
