// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VaultBase} from "./VaultBase.sol";
import {ProtocolConfig} from "../core/ProtocolConfig.sol";
import {JanSetuRegistry} from "../core/JanSetuRegistry.sol";
import {DigitalReceiptNFT} from "../core/DigitalReceiptNFT.sol";
import {ConfigKeys} from "../libraries/ConfigKeys.sol";

/// @title J-Recurring Growth Vault (RD).
/// @notice Monthly instalments (30-day months, deterministic). First instalment is paid when opening.
///         Grace period and late penalty are configurable. A loyalty bonus is paid only if every instalment
///         was on time AND the pool can fund it. Deck maturity figures are projections, not obligations.
contract RecurringDepositVault is VaultBase {
    uint256 internal constant MONTH = 30 days;

    struct Plan {
        uint128 monthly;
        uint16 months;
        uint16 rewardBps; // reward reserved per instalment, as bps of the instalment; set by governance
        bool enabled;
    }

    struct Account {
        uint128 monthly;
        uint16 months;
        uint16 paidCount;
        uint16 onTimeCount;
        uint16 rewardBps;
        uint16 graceDays;
        uint16 latePenaltyBps;
        uint16 earlyPenaltyBps;
        uint16 loyaltyBps;
        uint32 earlyAfterDays;
    }

    mapping(uint256 => Plan) public plans;
    uint256 public planCount;
    mapping(uint256 => Account) public accounts;
    mapping(uint256 => mapping(uint16 => bool)) public paid;

    event PlanAdded(uint256 indexed planId, uint256 monthly, uint16 months, uint16 rewardBps);
    event PlanEnabled(uint256 indexed planId, bool enabled);
    event Installment(uint256 indexed id, address indexed owner, address indexed payer, uint16 index, uint256 amount, uint256 latePenalty, bool onTime);
    event LoyaltyBonus(uint256 indexed id, uint256 funded, uint256 unfunded);

    error PlanNotAvailable();
    error InvalidInstallment();
    error AlreadyPaid();

    constructor(address admin, address forwarder, IERC20 token_, ProtocolConfig config_, JanSetuRegistry registry_, DigitalReceiptNFT receipts_)
        VaultBase(admin, forwarder, token_, config_, registry_, receipts_)
    {}

    function addPlan(uint256 monthly, uint16 months, uint16 rewardBps) external onlyRole(DEFAULT_ADMIN_ROLE) returns (uint256 planId) {
        require(monthly > 0 && months > 0 && rewardBps <= 20_000, "bad plan");
        planId = ++planCount;
        plans[planId] = Plan(uint128(monthly), months, rewardBps, true);
        emit PlanAdded(planId, monthly, months, rewardBps);
    }

    function setPlanEnabled(uint256 planId, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        plans[planId].enabled = enabled;
        emit PlanEnabled(planId, enabled);
    }

    /// @notice Open an RD and pay instalment 0 immediately.
    function open(uint256 planId) external whenNotPaused nonReentrant returns (uint256 id) {
        Plan memory plan = plans[planId];
        if (!plan.enabled) revert PlanNotAvailable();
        address owner = _msgSender();
        _requireEligible(owner);

        id = _create(owner, uint64(block.timestamp + uint256(plan.months) * MONTH), config.getUint(ConfigKeys.RD_COLLATERAL_ELIGIBLE) == 1);
        accounts[id] = Account({
            monthly: plan.monthly,
            months: plan.months,
            paidCount: 0,
            onTimeCount: 0,
            rewardBps: plan.rewardBps,
            graceDays: uint16(config.getUint(ConfigKeys.RD_GRACE_DAYS)),
            latePenaltyBps: uint16(config.getUint(ConfigKeys.RD_LATE_PENALTY_BPS)),
            earlyPenaltyBps: uint16(config.getUint(ConfigKeys.RD_EARLY_PENALTY_BPS)),
            loyaltyBps: uint16(config.getUint(ConfigKeys.RD_LOYALTY_BONUS_BPS)),
            earlyAfterDays: uint32(config.getUint(ConfigKeys.RD_EARLY_AFTER_DAYS))
        });
        _payInstallment(id, 0);
    }

    /// @notice Pay instalment `index` (0-based). Due at openedAt + index * 30 days; paying after the grace period adds a penalty.
    function pay(uint256 id, uint16 index) external whenNotPaused nonReentrant {
        if (_pos[id].status != Status.Active) revert NotActive();
        _payInstallment(id, index);
    }

    function withdrawEarly(uint256 id) external nonReentrant {
        Position storage p = _requireOwner(id);
        Account storage a = accounts[id];
        if (block.timestamp >= p.maturityAt) revert AlreadyMatured();
        if (block.timestamp < p.openedAt + uint256(a.earlyAfterDays) * 1 days) revert TooEarly();
        uint256 penalty = (uint256(p.principal) * a.earlyPenaltyBps) / BPS;
        _settle(id, penalty, false, 0, false);
    }

    /// @notice Maturity claim. Loyalty bonus only for a perfect on-time record and only if funded.
    function claim(uint256 id) external nonReentrant {
        Position storage p = _requireOwner(id);
        if (block.timestamp < p.maturityAt) revert NotMatured();
        Account storage a = accounts[id];
        uint256 bonus = 0;
        if (a.paidCount == a.months && a.onTimeCount == a.months && a.loyaltyBps > 0) {
            uint256 want = (uint256(p.principal) * a.loyaltyBps) / BPS;
            bonus = _takeFromPool(want);
            emit LoyaltyBonus(id, bonus, want - bonus);
        }
        _settle(id, 0, true, bonus, true);
    }

    // ---------------------------------------------------------------- views
    function dueAt(uint256 id, uint16 index) public view returns (uint256) {
        return _pos[id].openedAt + uint256(index) * MONTH;
    }

    /// @notice Instalments that are past their grace deadline and unpaid.
    function missedCount(uint256 id) external view returns (uint256 missed) {
        Position storage p = _pos[id];
        Account storage a = accounts[id];
        for (uint16 i; i < a.months; ++i) {
            if (!paid[id][i] && block.timestamp > dueAt(id, i) + uint256(a.graceDays) * 1 days && p.status == Status.Active) {
                ++missed;
            }
        }
    }

    // ---------------------------------------------------------------- internals
    function _payInstallment(uint256 id, uint16 index) private {
        Position storage p = _pos[id];
        Account storage a = accounts[id];
        if (block.timestamp >= p.maturityAt) revert AlreadyMatured();
        if (index >= a.months || (index != 0 && block.timestamp < dueAt(id, index))) revert InvalidInstallment();
        if (paid[id][index]) revert AlreadyPaid();

        uint256 amount = a.monthly;
        uint256 deadline = dueAt(id, index) + uint256(a.graceDays) * 1 days;
        bool onTime = block.timestamp <= deadline;
        uint256 penalty = onTime ? 0 : (amount * a.latePenaltyBps) / BPS;
        address payer = _msgSender();

        paid[id][index] = true;
        a.paidCount += 1;
        if (onTime) a.onTimeCount += 1;

        _pull(payer, amount + penalty);
        _credit(id, amount);
        rewardPool += penalty; // late penalty replenishes the reward pool, never an admin
        _reserve(id, (amount * a.rewardBps) / BPS);
        _receipt(p.owner, DigitalReceiptNFT.Kind.RdInstallment, ConfigKeys.RECEIPT_RD, id, amount);
        emit Installment(id, p.owner, payer, index, amount, penalty, onTime);
    }
}
