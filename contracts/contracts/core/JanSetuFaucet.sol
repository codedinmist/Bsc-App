// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";

/// @title tINR testnet faucet. Pre-funded (cannot mint). Per-wallet amount, cooldown and lifetime limits.
contract JanSetuFaucet is ERC2771Context, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 public constant MAX_CLAIM = 100_000 ether;
    uint256 public constant MIN_COOLDOWN = 1 hours;

    IERC20 public immutable token;
    uint256 public claimAmount;
    uint256 public cooldown;
    uint256 public maxPerWallet;

    mapping(address => uint256) public lastClaimAt;
    mapping(address => uint256) public totalClaimed;

    event Claimed(address indexed wallet, uint256 amount);
    event LimitsChanged(uint256 claimAmount, uint256 cooldown, uint256 maxPerWallet);

    error CooldownActive(uint256 availableAt);
    error WalletLimitReached();
    error FaucetEmpty();
    error InvalidLimits();
    error ContractCaller();

    constructor(address admin, IERC20 token_, address forwarder, uint256 amount, uint256 cooldown_, uint256 maxPerWallet_)
        ERC2771Context(forwarder)
    {
        token = token_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _setLimits(amount, cooldown_, maxPerWallet_);
    }

    function claim() external whenNotPaused nonReentrant {
        address who = _msgSender();
        if (who == address(this)) revert ContractCaller();
        uint256 last = lastClaimAt[who];
        if (last != 0 && block.timestamp < last + cooldown) revert CooldownActive(last + cooldown);
        uint256 amount = claimAmount;
        if (totalClaimed[who] + amount > maxPerWallet) revert WalletLimitReached();
        if (token.balanceOf(address(this)) < amount) revert FaucetEmpty();
        lastClaimAt[who] = block.timestamp;
        totalClaimed[who] += amount;
        token.safeTransfer(who, amount);
        emit Claimed(who, amount);
    }

    function nextClaimAt(address who) external view returns (uint256) {
        uint256 last = lastClaimAt[who];
        return last == 0 ? 0 : last + cooldown;
    }

    function setLimits(uint256 amount, uint256 cooldown_, uint256 maxPerWallet_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setLimits(amount, cooldown_, maxPerWallet_);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _setLimits(uint256 amount, uint256 cooldown_, uint256 maxPerWallet_) private {
        if (amount == 0 || amount > MAX_CLAIM || cooldown_ < MIN_COOLDOWN || maxPerWallet_ < amount) revert InvalidLimits();
        claimAmount = amount;
        cooldown = cooldown_;
        maxPerWallet = maxPerWallet_;
        emit LimitsChanged(amount, cooldown_, maxPerWallet_);
    }

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
