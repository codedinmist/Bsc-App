// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";

/// @title JanSetu Test Rupee (tINR)
/// @notice TESTNET-ONLY demonstration token. Not real rupees, not a stablecoin, not redeemable, no peg.
/// @dev No transfer tax, no blacklist, no owner withdrawal, no seizure. Burning is limited to the
///      caller's own balance. Supply is hard-capped. Transfers can be paused in an emergency.
contract INRToken is ERC20, ERC20Capped, ERC20Pausable, AccessControl, ERC2771Context {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    error ZeroAddress();

    constructor(address admin, address initialHolder, uint256 initialSupply, uint256 cap_, address trustedForwarder)
        ERC20("JanSetu Test Rupee", "tINR")
        ERC20Capped(cap_)
        ERC2771Context(trustedForwarder)
    {
        if (admin == address(0) || initialHolder == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        if (initialSupply > 0) _mint(initialHolder, initialSupply); // reverts above cap
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /// @notice Burns tokens from the CALLER's own balance only.
    function burn(uint256 amount) external onlyRole(BURNER_ROLE) {
        _burn(_msgSender(), amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ---- required overrides ----
    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Capped, ERC20Pausable) {
        super._update(from, to, value);
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
