// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title 48-hour public timelock. Proposer/executor/canceller = the Safe 3-of-5 multisig.
/// @dev Unmodified OpenZeppelin TimelockController. `admin` is address(0): no one can bypass the delay.
contract JanSetuTimelock is TimelockController {
    constructor(uint256 minDelay, address[] memory proposers, address[] memory executors)
        TimelockController(minDelay, proposers, executors, address(0))
    {}
}
