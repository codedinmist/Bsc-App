// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VaultBase} from "./VaultBase.sol";
import {ProtocolConfig} from "../core/ProtocolConfig.sol";
import {JanSetuRegistry} from "../core/JanSetuRegistry.sol";
import {DigitalReceiptNFT} from "../core/DigitalReceiptNFT.sol";
import {ConfigKeys} from "../libraries/ConfigKeys.sol";

/// @title J-Daily Micro Vault.
/// @notice Pick a daily tier (deck: 50/100/200/500 tINR), deposit once per day for the plan length (deck: 365 days).
///         Pre-maturity withdrawal of principal after 30 days (deck). Reward is paid ONLY if funded in the reward pool.
///         Projected returns in the deck are NOT guaranteed by this contract.
contract DailyVault is VaultBase {
    struct Account {
        uint128 installment;
        uint16 totalDays;
        uint16 paidCount;
        uint32 earlyAfterDays;
        uint16 earlyPenaltyBps;
        uint16 rewardBps;
    }

    mapping(uint256 => Account) public accounts;
    mapping(uint256 => mapping(uint16 => bool)) public paid;
    mapping(uint256 => bool) public tierEnabled;

    event TierSet(uint256 amount, bool enabled);
    event DailyDeposit(uint256 indexed id, address indexed owner, address indexed payer, uint16 dayIndex, uint256 amount);

    error TierNotAvailable();
    error BelowMinimum();
    error InvalidDay();
    error AlreadyPaid();

    constructor(address admin, address forwarder, IERC20 token_, ProtocolConfig config_, JanSetuRegistry registry_, DigitalReceiptNFT receipts_, uint256[] memory tiers)
        VaultBase(admin, forwarder, token_, config_, registry_, receipts_)
    {
        for (uint256 i; i < tiers.length; ++i) {
            tierEnabled[tiers[i]] = true;
            emit TierSet(tiers[i], true);
        }
    }

    function setTier(uint256 amount, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        tierEnabled[amount] = enabled;
        emit TierSet(amount, enabled);
    }

    /// @notice Open a daily account. Terms are snapshotted so later config changes never alter existing accounts.
    function open(uint256 installment) external whenNotPaused nonReentrant returns (uint256 id) {
        address owner = _msgSender();
        _requireEligible(owner);
        if (!tierEnabled[installment]) revert TierNotAvailable();
        if (installment < config.getUint(ConfigKeys.DAILY_MIN_DEPOSIT)) revert BelowMinimum();

        uint256 days_ = config.getUint(ConfigKeys.DAILY_DURATION_DAYS);
        id = _create(owner, uint64(block.timestamp + days_ * 1 days), config.getUint(ConfigKeys.DAILY_COLLATERAL_ELIGIBLE) == 1);
        accounts[id] = Account({
            installment: uint128(installment),
            totalDays: uint16(days_),
            paidCount: 0,
            earlyAfterDays: uint32(config.getUint(ConfigKeys.DAILY_EARLY_AFTER_DAYS)),
            earlyPenaltyBps: uint16(config.getUint(ConfigKeys.DAILY_EARLY_PENALTY_BPS)),
            rewardBps: uint16(config.getUint(ConfigKeys.DAILY_REWARD_BPS))
        });
    }

    /// @notice Pay the installment for `dayIndex` (0-based). Today or a missed past day, never a future day.
    ///         The payer may be someone else (e.g. an agent collecting cash); credit always goes to the owner.
    function deposit(uint256 id, uint16 dayIndex) external whenNotPaused nonReentrant {
        Position storage p = _pos[id];
        if (p.status != Status.Active) revert NotActive();
        Account storage a = accounts[id];
        if (block.timestamp >= p.maturityAt) revert AlreadyMatured();
        if (dayIndex >= a.totalDays || dayIndex > (block.timestamp - p.openedAt) / 1 days) revert InvalidDay();
        if (paid[id][dayIndex]) revert AlreadyPaid();

        uint256 amount = a.installment;
        address payer = _msgSender();
        paid[id][dayIndex] = true;
        a.paidCount += 1;

        _pull(payer, amount);
        _credit(id, amount);
        _reserve(id, (amount * a.rewardBps) / BPS);
        _receipt(p.owner, DigitalReceiptNFT.Kind.DailyDeposit, ConfigKeys.RECEIPT_DAILY, id, amount);
        emit DailyDeposit(id, p.owner, payer, dayIndex, amount);
    }

    /// @notice Pre-maturity withdrawal (after the early window). Returns principal minus penalty; forfeits reward.
    function withdrawEarly(uint256 id) external nonReentrant {
        Position storage p = _requireOwner(id);
        Account storage a = accounts[id];
        if (block.timestamp >= p.maturityAt) revert AlreadyMatured();
        if (block.timestamp < p.openedAt + uint256(a.earlyAfterDays) * 1 days) revert TooEarly();
        uint256 penalty = (uint256(p.principal) * a.earlyPenaltyBps) / BPS;
        _settle(id, penalty, false, 0, false);
    }

    /// @notice Maturity claim: principal + funded reward.
    function claim(uint256 id) external nonReentrant {
        Position storage p = _requireOwner(id);
        if (block.timestamp < p.maturityAt) revert NotMatured();
        _settle(id, 0, true, 0, true);
    }
}
