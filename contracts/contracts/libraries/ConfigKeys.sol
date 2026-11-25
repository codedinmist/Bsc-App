// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Keys for ProtocolConfig. Values in comments are the deck's defaults (set at deployment).
library ConfigKeys {
    bytes32 internal constant REQUIRE_KYC = keccak256("REQUIRE_KYC");

    bytes32 internal constant DAILY_MIN_DEPOSIT = keccak256("DAILY_MIN_DEPOSIT");           // 50 tINR
    bytes32 internal constant DAILY_DURATION_DAYS = keccak256("DAILY_DURATION_DAYS");       // 365
    bytes32 internal constant DAILY_EARLY_AFTER_DAYS = keccak256("DAILY_EARLY_AFTER_DAYS"); // 30
    bytes32 internal constant DAILY_EARLY_PENALTY_BPS = keccak256("DAILY_EARLY_PENALTY_BPS");
    bytes32 internal constant DAILY_REWARD_BPS = keccak256("DAILY_REWARD_BPS");
    bytes32 internal constant DAILY_COLLATERAL_ELIGIBLE = keccak256("DAILY_COLLATERAL_ELIGIBLE");
    bytes32 internal constant RECEIPT_DAILY = keccak256("RECEIPT_DAILY");

    bytes32 internal constant RD_GRACE_DAYS = keccak256("RD_GRACE_DAYS");
    bytes32 internal constant RD_LATE_PENALTY_BPS = keccak256("RD_LATE_PENALTY_BPS");
    bytes32 internal constant RD_EARLY_AFTER_DAYS = keccak256("RD_EARLY_AFTER_DAYS");
    bytes32 internal constant RD_EARLY_PENALTY_BPS = keccak256("RD_EARLY_PENALTY_BPS");
    bytes32 internal constant RD_LOYALTY_BONUS_BPS = keccak256("RD_LOYALTY_BONUS_BPS");
    bytes32 internal constant RD_COLLATERAL_ELIGIBLE = keccak256("RD_COLLATERAL_ELIGIBLE");
    bytes32 internal constant RECEIPT_RD = keccak256("RECEIPT_RD");

    bytes32 internal constant FD_MIN_DEPOSIT = keccak256("FD_MIN_DEPOSIT");
    bytes32 internal constant FD_EARLY_ALLOWED = keccak256("FD_EARLY_ALLOWED");
    bytes32 internal constant FD_EARLY_PENALTY_BPS = keccak256("FD_EARLY_PENALTY_BPS");
    bytes32 internal constant FD_COLLATERAL_ELIGIBLE = keccak256("FD_COLLATERAL_ELIGIBLE");
    bytes32 internal constant RECEIPT_FD = keccak256("RECEIPT_FD");
}
