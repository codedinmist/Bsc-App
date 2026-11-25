// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title JanSetu 3-of-5 multisig (deck slide 12).
/// @notice Owns the 48-hour timelock: any treasury or governance change needs `threshold` of the owners
///         to approve here, and then still waits the public time-lock. Owners are the five deck seats:
///         Founder, State Governor representative, External security auditor, Top agent representative,
///         Cold backup key.
/// @dev    Deliberately small. Owner set and threshold can only change by a transaction that this wallet
///         itself approves (self-call). This is a testnet-grade implementation of a standard pattern;
///         for mainnet use the audited Safe contracts instead (see docs/MULTISIG.md).
contract JanSetuMultiSig is ReentrancyGuard {
    struct Tx { address to; uint256 value; bytes data; bool executed; uint32 confirmations; uint64 createdAt; }

    uint256 public constant MIN_OWNERS = 3;
    uint256 public constant MAX_OWNERS = 9;

    address[] private _owners;
    mapping(address => bool) public isOwner;
    uint256 public threshold;

    Tx[] private _txs;
    mapping(uint256 => mapping(address => bool)) public confirmedBy;

    event Submitted(uint256 indexed id, address indexed by, address indexed to, uint256 value, bytes data);
    event Confirmed(uint256 indexed id, address indexed by);
    event Revoked(uint256 indexed id, address indexed by);
    event Executed(uint256 indexed id, address indexed by);
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event ThresholdChanged(uint256 threshold);
    event Received(address indexed from, uint256 value);

    error NotOwner();
    error NotSelf();
    error BadOwners();
    error BadThreshold();
    error UnknownTx();
    error AlreadyExecuted();
    error AlreadyConfirmed();
    error NotConfirmed();
    error NotEnoughConfirmations();
    error CallFailed(bytes reason);

    modifier onlyOwner() { if (!isOwner[msg.sender]) revert NotOwner(); _; }
    modifier onlySelf() { if (msg.sender != address(this)) revert NotSelf(); _; }

    constructor(address[] memory owners_, uint256 threshold_) {
        uint256 n = owners_.length;
        if (n < MIN_OWNERS || n > MAX_OWNERS) revert BadOwners();
        if (threshold_ < 2 || threshold_ > n) revert BadThreshold();
        for (uint256 i; i < n; ++i) {
            address o = owners_[i];
            if (o == address(0) || isOwner[o]) revert BadOwners();
            isOwner[o] = true;
            _owners.push(o);
            emit OwnerAdded(o);
        }
        threshold = threshold_;
        emit ThresholdChanged(threshold_);
    }

    receive() external payable { emit Received(msg.sender, msg.value); }

    // ------------------------------------------------------------------ proposals
    /// @notice Propose a call. The proposer's approval counts automatically.
    function submit(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256 id) {
        id = _txs.length;
        _txs.push(Tx({to: to, value: value, data: data, executed: false, confirmations: 0, createdAt: uint64(block.timestamp)}));
        emit Submitted(id, msg.sender, to, value, data);
        _confirm(id);
    }

    function confirm(uint256 id) external onlyOwner { _confirm(id); }

    function revoke(uint256 id) external onlyOwner {
        Tx storage t = _tx(id);
        if (t.executed) revert AlreadyExecuted();
        if (!confirmedBy[id][msg.sender]) revert NotConfirmed();
        confirmedBy[id][msg.sender] = false;
        t.confirmations -= 1;
        emit Revoked(id, msg.sender);
    }

    /// @notice Run a proposal once enough owners have approved. Any owner can trigger it.
    function execute(uint256 id) external onlyOwner nonReentrant returns (bytes memory ret) {
        Tx storage t = _tx(id);
        if (t.executed) revert AlreadyExecuted();
        if (validConfirmations(id) < threshold) revert NotEnoughConfirmations(); // only current owners count
        t.executed = true; // set before the call so it cannot run twice
        bool ok;
        (ok, ret) = t.to.call{value: t.value}(t.data);
        if (!ok) revert CallFailed(ret);
        emit Executed(id, msg.sender);
    }

    // ------------------------------------------------------------------ self-governance (only via an approved proposal)
    function addOwner(address o) external onlySelf {
        if (o == address(0) || isOwner[o] || _owners.length >= MAX_OWNERS) revert BadOwners();
        isOwner[o] = true; _owners.push(o);
        emit OwnerAdded(o);
    }

    function removeOwner(address o) external onlySelf {
        if (!isOwner[o] || _owners.length <= MIN_OWNERS || _owners.length - 1 < threshold) revert BadOwners();
        isOwner[o] = false;
        uint256 n = _owners.length;
        for (uint256 i; i < n; ++i) if (_owners[i] == o) { _owners[i] = _owners[n - 1]; _owners.pop(); break; }
        emit OwnerRemoved(o);
    }

    /// @notice Swap one owner for another in a single approved step (for example a lost key).
    function replaceOwner(address oldOwner, address newOwner) external onlySelf {
        if (!isOwner[oldOwner] || isOwner[newOwner] || newOwner == address(0)) revert BadOwners();
        uint256 n = _owners.length;
        for (uint256 i; i < n; ++i) if (_owners[i] == oldOwner) { _owners[i] = newOwner; break; }
        isOwner[oldOwner] = false; isOwner[newOwner] = true;
        emit OwnerRemoved(oldOwner); emit OwnerAdded(newOwner);
    }

    function changeThreshold(uint256 t) external onlySelf {
        if (t < 2 || t > _owners.length) revert BadThreshold();
        threshold = t;
        emit ThresholdChanged(t);
    }

    // ------------------------------------------------------------------ views
    function owners() external view returns (address[] memory) { return _owners; }
    function txCount() external view returns (uint256) { return _txs.length; }
    function getTx(uint256 id) external view returns (Tx memory) { return _tx(id); }

    /// @notice Approvals that come from people who are still owners (a removed owner's old approval stops counting).
    function validConfirmations(uint256 id) public view returns (uint256 n) {
        _tx(id);
        for (uint256 i; i < _owners.length; ++i) if (confirmedBy[id][_owners[i]]) ++n;
    }

    // ------------------------------------------------------------------ internal
    function _tx(uint256 id) private view returns (Tx storage) {
        if (id >= _txs.length) revert UnknownTx();
        return _txs[id];
    }

    function _confirm(uint256 id) private {
        Tx storage t = _tx(id);
        if (t.executed) revert AlreadyExecuted();
        if (confirmedBy[id][msg.sender]) revert AlreadyConfirmed();
        confirmedBy[id][msg.sender] = true;
        t.confirmations += 1;
        emit Confirmed(id, msg.sender);
    }
}
