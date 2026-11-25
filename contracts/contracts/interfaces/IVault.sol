// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Read/pledge surface shared by Daily, RD and FD vaults (matches VaultBase).
interface IVault {
    enum Status { None, Active, Closed }
    struct Position {
        address owner;
        uint128 principal;
        uint128 locked;
        uint128 rewardReserved;
        uint128 rewardUnfunded;
        uint64 openedAt;
        uint64 maturityAt;
        bool collateralEligible;
        Status status;
    }
    function getPosition(uint256 id) external view returns (Position memory);
    function idsOf(address owner) external view returns (uint256[] memory);
    function pledgedTo(uint256 id, address pledgee) external view returns (uint128);
    function release(uint256 id, uint256 amount) external;
    function seize(uint256 id, uint256 amount, address to) external;
    function fundRewards(uint256 amount) external;
}

interface IDailyView {
    function accounts(uint256 id) external view returns (uint128 installment, uint16 totalDays, uint16 paidCount, uint32 earlyAfterDays, uint16 earlyPenaltyBps, uint16 rewardBps);
}

interface IPausable { function pause() external; function unpause() external; function paused() external view returns (bool); }

interface IRDView {
    function accounts(uint256 id) external view returns (uint128 monthly, uint16 months, uint16 paidCount, uint16 onTimeCount, uint16 rewardBps, uint16 graceDays, uint16 latePenaltyBps, uint16 earlyPenaltyBps, uint16 loyaltyBps, uint32 earlyAfterDays);
}
