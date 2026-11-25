// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Loan liquidity pool. Lenders fund it; loan contracts draw and repay. Loans are never created from nothing.
/// @dev Customer savings vaults are NOT connected to this pool. Each loan contract has its own credit line
///      (a hard cap on its outstanding principal) and the pool keeps `maxUtilBps` of assets idle for withdrawals.
///      Share price rises with interest and falls on write-offs. Virtual shares blunt first-depositor/donation attacks.
contract LoanLiquidityPool is AccessControl, Pausable, ReentrancyGuard, ERC2771Context {
    using SafeERC20 for IERC20;

    bytes32 public constant BORROWER_ROLE = keccak256("BORROWER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint256 internal constant BPS = 10_000;
    uint256 internal constant VIRTUAL = 1e6;

    IERC20 public immutable token;
    uint256 public totalShares;
    uint256 public outstanding;
    uint256 public maxUtilBps = 8000;
    mapping(address => uint256) public shares;
    mapping(address => uint256) public creditLine;     // max outstanding per borrower contract
    mapping(address => uint256) public lentBy;         // outstanding per borrower contract

    event Deposited(address indexed lp, uint256 amount, uint256 sharesMinted);
    event Withdrawn(address indexed lp, uint256 amount, uint256 sharesBurned);
    event Lent(address indexed borrower, address indexed to, uint256 amount);
    event Repaid(address indexed borrower, uint256 principalPart, uint256 interestPart);
    event WrittenOff(address indexed borrower, uint256 amount);
    event CreditLineSet(address indexed borrower, uint256 cap);

    error OverLine(); error OverUtilisation(); error NoLiquidity(); error Zero(); error NotEnoughShares(); error FeeOnTransfer();

    constructor(address admin, IERC20 token_, address forwarder) ERC2771Context(forwarder) {
        token = token_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    function setCreditLine(address borrower, uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) { creditLine[borrower] = cap; emit CreditLineSet(borrower, cap); }
    function setMaxUtil(uint256 bps) external onlyRole(DEFAULT_ADMIN_ROLE) { require(bps <= 9500 && bps >= 1000, "bounds"); maxUtilBps = bps; }
    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    function idle() public view returns (uint256) { return token.balanceOf(address(this)); }
    function totalAssets() public view returns (uint256) { return idle() + outstanding; }

    function deposit(uint256 amount) external nonReentrant whenNotPaused returns (uint256 minted) {
        if (amount == 0) revert Zero();
        minted = (amount * (totalShares + VIRTUAL)) / (totalAssets() + VIRTUAL);
        uint256 b = idle();
        token.safeTransferFrom(_msgSender(), address(this), amount);
        if (idle() - b != amount) revert FeeOnTransfer();
        shares[_msgSender()] += minted; totalShares += minted;
        emit Deposited(_msgSender(), amount, minted);
    }

    /// @notice Always available (even paused), limited by idle cash.
    function withdraw(uint256 shareAmount) external nonReentrant returns (uint256 amount) {
        if (shareAmount == 0) revert Zero();
        if (shares[_msgSender()] < shareAmount) revert NotEnoughShares();
        amount = (shareAmount * (totalAssets() + VIRTUAL)) / (totalShares + VIRTUAL);
        if (amount > idle()) revert NoLiquidity();
        shares[_msgSender()] -= shareAmount; totalShares -= shareAmount;
        token.safeTransfer(_msgSender(), amount);
        emit Withdrawn(_msgSender(), amount, shareAmount);
    }

    function lpValue(address lp) external view returns (uint256) { return (shares[lp] * (totalAssets() + VIRTUAL)) / (totalShares + VIRTUAL); }

    // ---- borrower contracts
    function lend(address to, uint256 amount) external onlyRole(BORROWER_ROLE) whenNotPaused nonReentrant {
        if (amount == 0) revert Zero();
        if (lentBy[_msgSender()] + amount > creditLine[_msgSender()]) revert OverLine();
        if (outstanding + amount > (totalAssets() * maxUtilBps) / BPS) revert OverUtilisation();
        if (amount > idle()) revert NoLiquidity();
        outstanding += amount; lentBy[_msgSender()] += amount;
        token.safeTransfer(to, amount);
        emit Lent(_msgSender(), to, amount);
    }

    function repay(uint256 principalPart, uint256 interestPart) external onlyRole(BORROWER_ROLE) nonReentrant {
        if (principalPart > lentBy[_msgSender()]) principalPart = lentBy[_msgSender()]; // never underflow
        token.safeTransferFrom(_msgSender(), address(this), principalPart + interestPart);
        outstanding -= principalPart; lentBy[_msgSender()] -= principalPart;
        emit Repaid(_msgSender(), principalPart, interestPart);
    }

    function writeOff(uint256 principalLoss) external onlyRole(BORROWER_ROLE) nonReentrant {
        if (principalLoss > lentBy[_msgSender()]) principalLoss = lentBy[_msgSender()];
        outstanding -= principalLoss; lentBy[_msgSender()] -= principalLoss;
        emit WrittenOff(_msgSender(), principalLoss);
    }

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) { return ERC2771Context._msgSender(); }
    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) { return ERC2771Context._msgData(); }
    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) { return ERC2771Context._contextSuffixLength(); }
}
