// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VaultBase} from "./VaultBase.sol";
import {ProtocolConfig} from "../core/ProtocolConfig.sol";
import {JanSetuRegistry} from "../core/JanSetuRegistry.sol";
import {DigitalReceiptNFT} from "../core/DigitalReceiptNFT.sol";
import {ConfigKeys} from "../libraries/ConfigKeys.sol";

/// @title J-Treasury Fixed Vault (FD).
/// @notice Lump-sum deposit locked for 1/2/3 years (deck). The reward is reserved from the funded pool when the FD
///         opens. If the pool cannot cover it the FD still opens (principal is safe) but the reward is recorded as
///         UNFUNDED and will not be paid. A caller can demand a fully funded reward with `requireFundedReward`.
contract FixedDepositVault is VaultBase {
    struct Term {
        uint32 durationDays;
        uint16 rewardBps; // total reward over the term as bps of principal (deck projection encoded as a target)
        bool enabled;
    }

    struct Deposit {
        uint16 termId;
        uint16 earlyPenaltyBps;
        bool earlyAllowed;
    }

    mapping(uint256 => Term) public terms;
    uint256 public termCount;
    mapping(uint256 => Deposit) public deposits;

    event TermAdded(uint256 indexed termId, uint32 durationDays, uint16 rewardBps);
    event TermEnabled(uint256 indexed termId, bool enabled);
    event FixedDeposited(uint256 indexed id, address indexed owner, uint256 termId, uint256 amount, bool rewardFunded);

    error TermNotAvailable();
    error BelowMinimum();
    error RewardNotFunded();
    error EarlyWithdrawalDisabled();

    constructor(address admin, address forwarder, IERC20 token_, ProtocolConfig config_, JanSetuRegistry registry_, DigitalReceiptNFT receipts_)
        VaultBase(admin, forwarder, token_, config_, registry_, receipts_)
    {}

    function addTerm(uint32 durationDays, uint16 rewardBps) external onlyRole(DEFAULT_ADMIN_ROLE) returns (uint256 termId) {
        require(durationDays > 0 && rewardBps <= 20_000, "bad term");
        termId = ++termCount;
        terms[termId] = Term(durationDays, rewardBps, true);
        emit TermAdded(termId, durationDays, rewardBps);
    }

    function setTermEnabled(uint256 termId, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        terms[termId].enabled = enabled;
        emit TermEnabled(termId, enabled);
    }

    function open(uint256 termId, uint256 amount, bool requireFundedReward) external whenNotPaused nonReentrant returns (uint256 id) {
        Term memory t = terms[termId];
        if (!t.enabled) revert TermNotAvailable();
        if (amount < config.getUint(ConfigKeys.FD_MIN_DEPOSIT)) revert BelowMinimum();
        address owner = _msgSender();
        _requireEligible(owner);

        id = _create(owner, uint64(block.timestamp + uint256(t.durationDays) * 1 days), config.getUint(ConfigKeys.FD_COLLATERAL_ELIGIBLE) == 1);
        deposits[id] = Deposit(uint16(termId), uint16(config.getUint(ConfigKeys.FD_EARLY_PENALTY_BPS)), config.getUint(ConfigKeys.FD_EARLY_ALLOWED) == 1);

        _pull(owner, amount);
        _credit(id, amount);
        bool funded = _reserve(id, (amount * t.rewardBps) / BPS);
        if (requireFundedReward && !funded) revert RewardNotFunded();
        _receipt(owner, DigitalReceiptNFT.Kind.FdDeposit, ConfigKeys.RECEIPT_FD, id, amount);
        emit FixedDeposited(id, owner, termId, amount, funded);
    }

    function withdrawEarly(uint256 id) external nonReentrant {
        Position storage p = _requireOwner(id);
        Deposit storage d = deposits[id];
        if (!d.earlyAllowed) revert EarlyWithdrawalDisabled();
        if (block.timestamp >= p.maturityAt) revert AlreadyMatured();
        uint256 penalty = (uint256(p.principal) * d.earlyPenaltyBps) / BPS;
        _settle(id, penalty, false, 0, false);
    }

    function claim(uint256 id) external nonReentrant {
        Position storage p = _requireOwner(id);
        if (block.timestamp < p.maturityAt) revert NotMatured();
        _settle(id, 0, true, 0, true);
    }
}
