// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";

interface IAgentGate { function isAgentEligible(address account) external view returns (bool); }

/// @title Participant registry: roles, KYC flag, agent verification, geography.
/// @dev Stores NO personal data. KYC is a boolean set by an authorised operator after off-chain checks.
///      No one can grant themselves a role. Higher roles need governance (timelock); agent onboarding and
///      verification use the operations multisig.
contract JanSetuRegistry is ERC2771Context, AccessControl {
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE"); // timelock: cluster/district/state/treasury/guardian roles
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE"); // ops multisig: KYC, agent verify, suspend

    enum Role { None, Customer, Agent, ClusterValidator, DistrictLead, StateGovernor, TreasuryAdmin, SecurityGuardian }

    struct Profile {
        Role role;
        bool kycVerified;
        bool agentVerified;
        bool suspended;
        uint32 clusterId;
        uint32 districtId;
        uint32 stateId;
        uint64 registeredAt;
    }

    mapping(address => Profile) private _profiles;
    /// @notice Optional eligibility rules for agents (deck slide 7: own investment, stake, 2 referrals). Set by governance.
    address public agentGate;
    event AgentGateSet(address gate);

    event Registered(address indexed account);
    event RoleAssigned(address indexed account, Role oldRole, Role newRole, address indexed by);
    event RoleRevoked(address indexed account, Role oldRole, address indexed by);
    event KycSet(address indexed account, bool verified, address indexed by);
    event AgentVerificationSet(address indexed account, bool verified, address indexed by);
    event Suspended(address indexed account, bytes32 reasonHash, address indexed by);
    event Reinstated(address indexed account, address indexed by);
    event GeographySet(address indexed account, uint32 clusterId, uint32 districtId, uint32 stateId);

    error AlreadyRegistered();
    error NotRegistered();
    error InvalidRole();
    error SelfAssignment();
    error NotAnAgent();
    error AgentNotEligible();

    constructor(address admin, address forwarder) ERC2771Context(forwarder) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GOVERNOR_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
    }

    // ---------------- self service ----------------
    function register() external {
        address who = _msgSender();
        if (_profiles[who].role != Role.None) revert AlreadyRegistered();
        _profiles[who].role = Role.Customer;
        _profiles[who].registeredAt = uint64(block.timestamp);
        emit Registered(who);
        emit RoleAssigned(who, Role.None, Role.Customer, who);
    }

    // ---------------- operations ----------------
    function setKyc(address account, bool verified) external onlyRole(OPERATOR_ROLE) {
        _requireRegistered(account);
        _profiles[account].kycVerified = verified;
        emit KycSet(account, verified, _msgSender());
    }

    /// @notice Make a registered account an Agent (not yet verified). Eligibility is checked off-chain
    ///         and by AgentStaking (stake + vouches) before verification.
    function assignAgent(address account, uint32 clusterId, uint32 districtId, uint32 stateId) external onlyRole(OPERATOR_ROLE) {
        _requireRegistered(account);
        if (account == _msgSender()) revert SelfAssignment();
        Role old = _profiles[account].role;
        _profiles[account].role = Role.Agent;
        _setGeo(account, clusterId, districtId, stateId);
        emit RoleAssigned(account, old, Role.Agent, _msgSender());
    }

    function setAgentVerified(address account, bool verified) external onlyRole(OPERATOR_ROLE) {
        if (_profiles[account].role != Role.Agent) revert NotAnAgent();
        if (verified && agentGate != address(0) && !IAgentGate(agentGate).isAgentEligible(account)) revert AgentNotEligible();
        _profiles[account].agentVerified = verified;
        emit AgentVerificationSet(account, verified, _msgSender());
    }

    function suspend(address account, bytes32 reasonHash) external onlyRole(OPERATOR_ROLE) {
        _requireRegistered(account);
        _profiles[account].suspended = true;
        emit Suspended(account, reasonHash, _msgSender());
    }

    function reinstate(address account) external onlyRole(OPERATOR_ROLE) {
        _requireRegistered(account);
        _profiles[account].suspended = false;
        emit Reinstated(account, _msgSender());
    }

    // ---------------- governance ----------------
    function setAgentGate(address gate) external onlyRole(GOVERNOR_ROLE) { agentGate = gate; emit AgentGateSet(gate); }

    function assignRole(address account, Role role, uint32 clusterId, uint32 districtId, uint32 stateId)
        external
        onlyRole(GOVERNOR_ROLE)
    {
        if (role < Role.ClusterValidator) revert InvalidRole(); // None/Customer/Agent handled elsewhere
        _requireRegistered(account);
        if (account == _msgSender()) revert SelfAssignment();
        Role old = _profiles[account].role;
        _profiles[account].role = role;
        _setGeo(account, clusterId, districtId, stateId);
        emit RoleAssigned(account, old, role, _msgSender());
    }

    function revokeParticipantRole(address account) external onlyRole(GOVERNOR_ROLE) {
        _requireRegistered(account);
        Role old = _profiles[account].role;
        _profiles[account].role = Role.Customer;
        _profiles[account].agentVerified = false;
        emit RoleRevoked(account, old, _msgSender());
    }

    // ---------------- views ----------------
    function profileOf(address account) external view returns (Profile memory) {
        return _profiles[account];
    }

    function roleOf(address account) external view returns (Role) {
        return _profiles[account].role;
    }

    function isRegistered(address account) external view returns (bool) {
        return _profiles[account].role != Role.None;
    }

    function isKyc(address account) external view returns (bool) {
        return _profiles[account].kycVerified;
    }

    /// @notice An account that was made an agent by an operator (may not be verified yet). Customers can refer to it.
    function isAgentCandidate(address account) external view returns (bool) {
        Profile storage p = _profiles[account];
        return p.role == Role.Agent && !p.suspended;
    }

    function isActiveAgent(address account) external view returns (bool) {
        Profile storage p = _profiles[account];
        return p.role == Role.Agent && p.agentVerified && !p.suspended;
    }

    // ---------------- internals ----------------
    function _requireRegistered(address account) private view {
        if (_profiles[account].role == Role.None) revert NotRegistered();
    }

    function _setGeo(address account, uint32 c, uint32 d, uint32 s) private {
        _profiles[account].clusterId = c;
        _profiles[account].districtId = d;
        _profiles[account].stateId = s;
        emit GeographySet(account, c, d, s);
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
