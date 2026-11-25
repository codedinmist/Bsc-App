// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface ILoanPool {
    function lend(address to, uint256 amount) external;
    function repay(uint256 principalPart, uint256 interestPart) external;
    function writeOff(uint256 principalLoss) external;
}
interface ICreditScore {
    function recordOnTime(address user) external;
    function recordLate(address user) external;
    function recordCompleted(address user) external;
    function recordDefault(address user) external;
    function scoreOf(address user) external view returns (uint256);
}
