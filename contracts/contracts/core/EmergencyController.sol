// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IPausable} from "../interfaces/IVault.sol";

/// @title One-button emergency stop.
/// @dev The controller must hold the pauser role on each target (vault PAUSER_ROLE, staking/escrow GUARDIAN_ROLE).
///      GUARDIAN can only pause. Only admin (the 48h timelock) can unpause or change the target list.
///      Pausing blocks NEW risk only: withdrawals, unstake, refunds and loan repayments keep working in every target.
contract EmergencyController is AccessControl {
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    address[] private _targets;
    mapping(address => bool) public isTarget;
    bool public stopped;

    event TargetAdded(address indexed target);
    event TargetRemoved(address indexed target);
    event EmergencyStop(address indexed by, uint256 paused, uint256 failed);
    event EmergencyLifted(address indexed by, uint256 unpaused, uint256 failed);

    error AlreadyTarget();
    error NotTarget();

    constructor(address admin, address guardian) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, guardian);
    }

    function addTarget(address t) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (isTarget[t]) revert AlreadyTarget();
        isTarget[t] = true; _targets.push(t); emit TargetAdded(t);
    }

    function removeTarget(address t) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!isTarget[t]) revert NotTarget();
        isTarget[t] = false;
        for (uint256 i; i < _targets.length; ++i) if (_targets[i] == t) { _targets[i] = _targets[_targets.length - 1]; _targets.pop(); break; }
        emit TargetRemoved(t);
    }

    function targets() external view returns (address[] memory) { return _targets; }

    /// @notice Pause every target. A target that fails to pause does not stop the others.
    function pauseAll() external onlyRole(GUARDIAN_ROLE) {
        uint256 ok; uint256 bad;
        for (uint256 i; i < _targets.length; ++i) {
            try IPausable(_targets[i]).pause() { ++ok; } catch { if (!IPausable(_targets[i]).paused()) ++bad; else ++ok; }
        }
        stopped = true;
        emit EmergencyStop(msg.sender, ok, bad);
    }

    function unpauseAll() external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 ok; uint256 bad;
        for (uint256 i; i < _targets.length; ++i) {
            try IPausable(_targets[i]).unpause() { ++ok; } catch { if (IPausable(_targets[i]).paused()) ++bad; else ++ok; }
        }
        stopped = false;
        emit EmergencyLifted(msg.sender, ok, bad);
    }
}
