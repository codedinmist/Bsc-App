// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IVault, IDailyView} from "../interfaces/IVault.sol";
import {CommissionManager} from "./CommissionManager.sol";

/// @title Rewards: account-opening bonuses, Super Recruiter booster and Dream Club milestones (deck slides 8-9).
/// @dev All payouts come from a funded pool and each right can be claimed once. The numbers are testnet
///      parameters held in storage and changeable only by the admin (timelock); Dream Club prize amounts are placeholders.
///      A bonus needs the position to still be ACTIVE and at least `minAge` old, so open-claim-withdraw is not profitable.
contract RewardsManager is AccessControl, ReentrancyGuard, ERC2771Context {
    using SafeERC20 for IERC20;

    enum Kind { None, Daily, RD, FD }

    IERC20 public immutable token;
    CommissionManager public immutable commissions;

    mapping(address => Kind) public vaultKind;
    uint256 public pool;
    uint64 public minAge = 30 days;

    // bonus parameters (tINR, 18 decimals)
    uint256 public dailyMinInstallment = 100e18; uint16 public dailyMinPaid = 7; uint256 public dailyBonus = 100e18;
    uint256 public rdMinPrincipal = 1_000e18;   uint256 public rdBonus = 250e18;
    uint256 public fdTier1 = 25_000e18;  uint256 public fdBonus1 = 500e18;
    uint256 public fdTier2 = 100_000e18; uint256 public fdBonus2 = 1_500e18;
    uint256 public boosterAccounts = 25; uint256 public boosterReward = 5_000e18;

    struct Milestone { uint256 volume; uint256 reward; }
    Milestone[] public milestones; // Dream Club: 5L, 25L, 1Cr, 5Cr volume

    mapping(bytes32 => bool) public bonusClaimed;                       // keccak(vault,id)
    mapping(address => mapping(uint256 => bool)) public boosterClaimed; // agent => month
    mapping(address => mapping(uint256 => bool)) public milestoneClaimed;

    event Funded(address indexed from, uint256 amount);
    event BonusPaid(address indexed to, address indexed vault, uint256 indexed id, uint256 amount);
    event BoosterPaid(address indexed agent, uint256 month, uint256 amount);
    event MilestonePaid(address indexed agent, uint256 index, uint256 amount);
    event Unfunded(string what);

    error NotOwner(); error NotActive(); error TooYoung(); error NotEligible(); error AlreadyClaimed(); error UnknownVault(); error PoolShort();

    constructor(address admin, IERC20 token_, CommissionManager commissions_, address forwarder) ERC2771Context(forwarder) {
        token = token_; commissions = commissions_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        milestones.push(Milestone(500_000e18, 5_000e18));
        milestones.push(Milestone(2_500_000e18, 25_000e18));
        milestones.push(Milestone(10_000_000e18, 100_000e18));
        milestones.push(Milestone(50_000_000e18, 500_000e18));
    }

    function setVault(address vault, Kind k) external onlyRole(DEFAULT_ADMIN_ROLE) { vaultKind[vault] = k; }

    function setMinAge(uint64 a) external onlyRole(DEFAULT_ADMIN_ROLE) { require(a <= 365 days, "age"); minAge = a; }

    function fund(uint256 amount) external nonReentrant {
        uint256 b = token.balanceOf(address(this));
        token.safeTransferFrom(_msgSender(), address(this), amount);
        require(token.balanceOf(address(this)) - b == amount, "fee on transfer");
        pool += amount; emit Funded(_msgSender(), amount);
    }

    /// @notice Account-opening bonus for one position. Pays only if the pool can cover it.
    function claimAccountBonus(address vault, uint256 id) external nonReentrant {
        Kind k = vaultKind[vault];
        if (k == Kind.None) revert UnknownVault();
        bytes32 key = keccak256(abi.encode(vault, id));
        if (bonusClaimed[key]) revert AlreadyClaimed();
        IVault.Position memory p = IVault(vault).getPosition(id);
        if (p.owner != _msgSender()) revert NotOwner();
        if (p.status != IVault.Status.Active) revert NotActive();
        if (block.timestamp < uint256(p.openedAt) + minAge) revert TooYoung();

        uint256 amount;
        if (k == Kind.Daily) {
            (uint128 inst,, uint16 paidCount,,,) = IDailyView(vault).accounts(id);
            if (inst >= dailyMinInstallment && paidCount >= dailyMinPaid) amount = dailyBonus;
        } else if (k == Kind.RD) {
            if (p.principal >= rdMinPrincipal) amount = rdBonus;
        } else {
            amount = p.principal >= fdTier2 ? fdBonus2 : p.principal >= fdTier1 ? fdBonus1 : 0;
        }
        if (amount == 0) revert NotEligible();
        _pay(_msgSender(), amount);
        bonusClaimed[key] = true;
        emit BonusPaid(_msgSender(), vault, id, amount);
    }

    /// @notice Super Recruiter: an agent whose customers opened `boosterAccounts` accounts in a 30-day period.
    function claimBooster(uint256 month) external nonReentrant {
        if (boosterClaimed[_msgSender()][month]) revert AlreadyClaimed();
        if (commissions.monthAccounts(_msgSender(), month) < boosterAccounts) revert NotEligible();
        _pay(_msgSender(), boosterReward);
        boosterClaimed[_msgSender()][month] = true;
        emit BoosterPaid(_msgSender(), month, boosterReward);
    }

    /// @notice Dream Club: cumulative referred volume milestones.
    function claimMilestone(uint256 index) external nonReentrant {
        if (index >= milestones.length) revert NotEligible();
        if (milestoneClaimed[_msgSender()][index]) revert AlreadyClaimed();
        Milestone memory m = milestones[index];
        if (commissions.agentVolume(_msgSender()) < m.volume) revert NotEligible();
        _pay(_msgSender(), m.reward);
        milestoneClaimed[_msgSender()][index] = true;
        emit MilestonePaid(_msgSender(), index, m.reward);
    }

    function milestoneCount() external view returns (uint256) { return milestones.length; }
    function isSolvent() external view returns (bool) { return token.balanceOf(address(this)) >= pool; }

    function _pay(address to, uint256 amount) private {
        if (pool < amount) revert PoolShort(); // reverts, so the right is NOT consumed and can be claimed after funding
        pool -= amount;
        token.safeTransfer(to, amount);
    }

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) { return ERC2771Context._msgSender(); }
    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) { return ERC2771Context._msgData(); }
    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) { return ERC2771Context._contextSuffixLength(); }
}
