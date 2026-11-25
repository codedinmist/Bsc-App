// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {JanSetuRegistry} from "../core/JanSetuRegistry.sol";
import {AgentStaking} from "../core/AgentStaking.sol";
import {IVault} from "../interfaces/IVault.sol";
import {CommissionManager} from "./CommissionManager.sol";

interface IServiceCheckpoint { function checkpointDistrict(uint32 districtId) external; }

/// @title Network ranks (deck slide 7): who may be an agent, and automatic promotion by volume.
/// @dev
///  AGENT   : KYC done + stake >= minimum (AgentStaking) + own savings >= 5,000 + at least 2 KYC'd customers who chose them.
///            The registry asks `isAgentEligible` before an operator can verify an agent.
///  CLUSTER : 10 active agents in the cluster + 15 lakh team volume.
///  DISTRICT: 5 headed clusters in the district + 1 crore district volume.
///  STATE   : 10 headed districts in the state + 10 crore state volume.
///  Promotion is permissionless and rule-driven: when a level's numbers are met, anyone calls `promote*`; the agent with
///  the highest own volume in that area becomes head, and this contract sets the commission payee through
///  CommissionManager.RANKS_ROLE (which can only call setHead). The registry role stays "Agent", so heads keep working as agents.
///  Volume is the principal counted by CommissionManager. Governance (timelock) can revoke a head and change thresholds.
contract NetworkRanks is AccessControl {
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");

    enum Rank { None, Agent, Cluster, District, State }

    JanSetuRegistry public immutable registry;
    AgentStaking public immutable staking;
    CommissionManager public immutable commissions;
    IVault[] public vaults;
    IServiceCheckpoint public service; // optional hook so district prediction shares stay fair when volume changes

    // thresholds (tINR 1:1 with rupees)
    uint256 public ownInvestmentMin = 5_000e18; uint16 public referralsMin = 2;
    uint16 public clusterAgentsMin = 10;  uint256 public clusterVolumeMin = 1_500_000e18;
    uint16 public districtClustersMin = 5; uint256 public districtVolumeMin = 10_000_000e18;
    uint16 public stateDistrictsMin = 10;  uint256 public stateVolumeMin = 100_000_000e18;

    mapping(address => Rank) public rankOf;
    mapping(address => bool) public tracked;       // agent counted in cluster totals
    mapping(address => uint256) public seenVolume; // part of agentVolume already added to the area totals

    mapping(uint32 => uint32) public clusterDistrict; mapping(uint32 => uint32) public districtState;
    mapping(uint32 => uint16) public clusterAgents;
    mapping(uint32 => uint256) public clusterVolume; mapping(uint32 => uint256) public districtVolume; mapping(uint32 => uint256) public stateVolume;
    uint256 public totalDistrictVolume;
    mapping(uint32 => address) public clusterLeader; mapping(uint32 => address) public districtLeader; mapping(uint32 => address) public stateLeader;
    mapping(uint32 => address) public clusterHead; mapping(uint32 => address) public districtHead; mapping(uint32 => address) public stateHead;
    mapping(uint32 => uint16) public clustersInDistrict; mapping(uint32 => uint16) public districtsInState;

    event Tracked(address indexed agent, uint32 cluster, uint32 district, uint32 state);
    event VolumeAdded(address indexed agent, uint256 amount);
    event Promoted(uint8 level, uint32 areaId, address indexed head);
    event HeadRevoked(uint8 level, uint32 areaId, address indexed head);
    event ServiceSet(address service);
    event ThresholdsSet();

    error NotActiveAgent(); error NotReady(); error AlreadyHeaded(); error NoHead(); error NoLeader();

    constructor(address admin, JanSetuRegistry registry_, AgentStaking staking_, CommissionManager commissions_, address[] memory vaults_) {
        registry = registry_; staking = staking_; commissions = commissions_;
        for (uint256 i; i < vaults_.length; ++i) vaults.push(IVault(vaults_[i]));
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GOVERNOR_ROLE, admin);
    }

    // ------------------------------------------------------------ governance
    function setService(address s) external onlyRole(DEFAULT_ADMIN_ROLE) { service = IServiceCheckpoint(s); emit ServiceSet(s); }

    function setThresholds(
        uint256 ownMin, uint16 refsMin, uint16 cAgents, uint256 cVol, uint16 dClusters, uint256 dVol, uint16 sDistricts, uint256 sVol
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(refsMin <= 20 && cAgents > 0 && dClusters > 0 && sDistricts > 0 && ownMin <= 1_000_000e18, "bounds");
        ownInvestmentMin = ownMin; referralsMin = refsMin;
        clusterAgentsMin = cAgents; clusterVolumeMin = cVol;
        districtClustersMin = dClusters; districtVolumeMin = dVol;
        stateDistrictsMin = sDistricts; stateVolumeMin = sVol;
        emit ThresholdsSet();
    }

    /// @notice Governance can take a head back (misconduct). The area can be promoted again later.
    function revokeHead(uint8 level, uint32 areaId) external onlyRole(GOVERNOR_ROLE) {
        address h;
        if (level == 1) { h = clusterHead[areaId]; clusterHead[areaId] = address(0); uint32 d = clusterDistrict[areaId]; if (clustersInDistrict[d] > 0) clustersInDistrict[d]--; }
        else if (level == 2) { h = districtHead[areaId]; districtHead[areaId] = address(0); uint32 s = districtState[areaId]; if (districtsInState[s] > 0) districtsInState[s]--; }
        else if (level == 3) { h = stateHead[areaId]; stateHead[areaId] = address(0); }
        else revert NoHead();
        if (h == address(0)) revert NoHead();
        commissions.setHead(level, areaId, address(0));
        if (rankOf[h] == Rank(level + 1)) rankOf[h] = Rank.Agent;
        emit HeadRevoked(level, areaId, h);
    }

    // ------------------------------------------------------------ agent gate (called by the registry)
    function isAgentEligible(address agent) public view returns (bool) {
        if (!registry.isKyc(agent)) return false;
        if (!staking.isEligible(agent)) return false;
        if (ownInvestment(agent) < ownInvestmentMin) return false;
        return kycReferrals(agent) >= referralsMin;
    }

    /// @notice Active principal the agent holds in Daily / RD / FD (bounded loop; testnet scale).
    function ownInvestment(address agent) public view returns (uint256 total) {
        for (uint256 v; v < vaults.length; ++v) {
            uint256[] memory ids = vaults[v].idsOf(agent);
            uint256 n = ids.length > 100 ? 100 : ids.length;
            for (uint256 i; i < n; ++i) {
                IVault.Position memory p = vaults[v].getPosition(ids[i]);
                if (p.status == IVault.Status.Active) total += p.principal;
            }
        }
    }

    /// @notice Customers who chose this agent and are KYC-verified and not suspended.
    function kycReferrals(address agent) public view returns (uint256 n) {
        uint256 len = commissions.referralCount(agent);
        if (len > 200) len = 200;
        for (uint256 i; i < len; ++i) {
            address c = commissions.referralAt(agent, i);
            JanSetuRegistry.Profile memory p = registry.profileOf(c);
            if (p.kycVerified && !p.suspended) n++;
        }
    }

    // ------------------------------------------------------------ tracking (permissionless)
    /// @notice Adds an agent to its cluster's count and brings its counted volume into the area totals.
    function syncAgent(address agent) external {
        if (!registry.isActiveAgent(agent)) revert NotActiveAgent();
        JanSetuRegistry.Profile memory p = registry.profileOf(agent);
        if (!tracked[agent]) {
            tracked[agent] = true;
            clusterAgents[p.clusterId]++;
            clusterDistrict[p.clusterId] = p.districtId;
            districtState[p.districtId] = p.stateId;
            if (rankOf[agent] == Rank.None) rankOf[agent] = Rank.Agent;
            emit Tracked(agent, p.clusterId, p.districtId, p.stateId);
        }
        uint256 vol = commissions.agentVolume(agent);
        uint256 delta = vol - seenVolume[agent];
        if (delta == 0) return;
        if (address(service) != address(0)) service.checkpointDistrict(p.districtId); // settle shares at the OLD weight first
        seenVolume[agent] = vol;
        clusterVolume[p.clusterId] += delta; districtVolume[p.districtId] += delta; stateVolume[p.stateId] += delta;
        totalDistrictVolume += delta;
        if (_vol(clusterLeader[p.clusterId]) < vol) clusterLeader[p.clusterId] = agent;
        if (_vol(districtLeader[p.districtId]) < vol) districtLeader[p.districtId] = agent;
        if (_vol(stateLeader[p.stateId]) < vol) stateLeader[p.stateId] = agent;
        emit VolumeAdded(agent, delta);
    }

    function _vol(address a) private view returns (uint256) { return a == address(0) ? 0 : seenVolume[a]; }

    // ------------------------------------------------------------ promotion (permissionless once the numbers are met)
    function promoteCluster(uint32 clusterId) external {
        if (clusterHead[clusterId] != address(0)) revert AlreadyHeaded();
        if (clusterAgents[clusterId] < clusterAgentsMin || clusterVolume[clusterId] < clusterVolumeMin) revert NotReady();
        address h = _leader(clusterLeader[clusterId]);
        clusterHead[clusterId] = h;
        clustersInDistrict[clusterDistrict[clusterId]]++;
        _raise(h, Rank.Cluster);
        commissions.setHead(1, clusterId, h);
        emit Promoted(1, clusterId, h);
    }

    function promoteDistrict(uint32 districtId) external {
        if (districtHead[districtId] != address(0)) revert AlreadyHeaded();
        if (clustersInDistrict[districtId] < districtClustersMin || districtVolume[districtId] < districtVolumeMin) revert NotReady();
        address h = _leader(districtLeader[districtId]);
        districtHead[districtId] = h;
        districtsInState[districtState[districtId]]++;
        _raise(h, Rank.District);
        commissions.setHead(2, districtId, h);
        emit Promoted(2, districtId, h);
    }

    function promoteState(uint32 stateId) external {
        if (stateHead[stateId] != address(0)) revert AlreadyHeaded();
        if (districtsInState[stateId] < stateDistrictsMin || stateVolume[stateId] < stateVolumeMin) revert NotReady();
        address h = _leader(stateLeader[stateId]);
        stateHead[stateId] = h;
        _raise(h, Rank.State);
        commissions.setHead(3, stateId, h);
        emit Promoted(3, stateId, h);
    }

    function _leader(address l) private view returns (address) {
        if (l == address(0)) revert NoLeader();
        if (!registry.isActiveAgent(l)) revert NotActiveAgent();
        return l;
    }

    function _raise(address h, Rank r) private { if (rankOf[h] < r) rankOf[h] = r; }
}
