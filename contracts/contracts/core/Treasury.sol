// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IVault} from "../interfaces/IVault.sol";

/// @title Treasury. Holds protocol funds (slashed stakes, fees, DAO share) and tops up the funded pools.
/// @dev Every outflow needs SPENDER_ROLE (the 48h timelock) and is limited by a rolling per-day cap, so a
///      compromised spender cannot drain it in one go. Customer principal never sits here.
contract Treasury is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant SPENDER_ROLE = keccak256("SPENDER_ROLE");

    IERC20 public immutable token;
    uint256 public dailyCap;
    uint256 public dayStart;
    uint256 public spentToday;

    event Spent(address indexed to, uint256 amount, bytes32 reasonHash);
    event VaultToppedUp(address indexed vault, uint256 amount);
    event DailyCapSet(uint256 cap);

    error OverDailyCap();
    error ZeroAddress();

    constructor(address admin, IERC20 token_, uint256 dailyCap_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
        dailyCap = dailyCap_;
        dayStart = block.timestamp;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SPENDER_ROLE, admin);
    }

    function setDailyCap(uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) { dailyCap = cap; emit DailyCapSet(cap); }

    function spend(address to, uint256 amount, bytes32 reasonHash) external onlyRole(SPENDER_ROLE) nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        _count(amount);
        token.safeTransfer(to, amount);
        emit Spent(to, amount, reasonHash);
    }

    /// @notice Fund a vault's reward pool from the treasury.
    function topUpVault(address vault, uint256 amount) external onlyRole(SPENDER_ROLE) nonReentrant {
        _count(amount);
        token.forceApprove(vault, amount);
        IVault(vault).fundRewards(amount);
        token.forceApprove(vault, 0);
        emit VaultToppedUp(vault, amount);
    }

    function _count(uint256 amount) private {
        if (block.timestamp >= dayStart + 1 days) { dayStart = block.timestamp; spentToday = 0; }
        spentToday += amount;
        if (spentToday > dailyCap) revert OverDailyCap();
    }
}
