// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title Central, bounded protocol parameters.
/// @dev Every key has hard min/max bounds. Both roles are meant to be held by the 48h TimelockController
///      after deployment, so no single admin can change a critical value instantly.
contract ProtocolConfig is AccessControl {
    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");

    struct Bounds {
        uint256 min;
        uint256 max;
        bool defined;
    }

    mapping(bytes32 => uint256) private _values;
    mapping(bytes32 => Bounds) public bounds;

    event KeyDefined(bytes32 indexed key, uint256 min, uint256 max, uint256 initial);
    event ConfigChanged(bytes32 indexed key, uint256 oldValue, uint256 newValue, address indexed by);

    error UnknownKey(bytes32 key);
    error OutOfBounds(bytes32 key, uint256 value);
    error InvalidBounds();
    error AlreadyDefined(bytes32 key);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CONFIG_ROLE, admin);
    }

    function defineKey(bytes32 key, uint256 min, uint256 max, uint256 initial) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bounds[key].defined) revert AlreadyDefined(key);
        if (min > max || initial < min || initial > max) revert InvalidBounds();
        bounds[key] = Bounds(min, max, true);
        _values[key] = initial;
        emit KeyDefined(key, min, max, initial);
    }

    function setUint(bytes32 key, uint256 value) external onlyRole(CONFIG_ROLE) {
        Bounds memory b = bounds[key];
        if (!b.defined) revert UnknownKey(key);
        if (value < b.min || value > b.max) revert OutOfBounds(key, value);
        uint256 old = _values[key];
        _values[key] = value;
        emit ConfigChanged(key, old, value, msg.sender);
    }

    function getUint(bytes32 key) external view returns (uint256) {
        if (!bounds[key].defined) revert UnknownKey(key);
        return _values[key];
    }
}
