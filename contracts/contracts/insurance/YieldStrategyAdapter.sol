// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IYieldStrategy {
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external returns (uint256 received);
    function totalAssets() external view returns (uint256);
}

/// @title Yield adapter (deck slide 6) - SIMULATED on testnet.
/// @dev Treasury-only: it can invest ONLY funds that were sent to it from the treasury, up to `cap`. It is not connected
///      to any customer vault. The strategy is swappable behind IYieldStrategy; testnet uses MockStrategy.
contract YieldStrategyAdapter is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    bytes32 public constant ALLOCATOR_ROLE = keccak256("ALLOCATOR_ROLE");
    IERC20 public immutable token;
    address public immutable treasury;
    IYieldStrategy public strategy;
    uint256 public cap;
    uint256 public invested;

    event Invested(uint256 amount); event Divested(uint256 amount); event ReturnedToTreasury(uint256 amount); event StrategySet(address strategy);
    error OverCap(); error NoStrategy();

    constructor(address admin, IERC20 token_, address treasury_, uint256 cap_) { token = token_; treasury = treasury_; cap = cap_; _grantRole(DEFAULT_ADMIN_ROLE, admin); _grantRole(ALLOCATOR_ROLE, admin); }

    function setStrategy(IYieldStrategy s) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(invested == 0, "divest first");
        strategy = s; emit StrategySet(address(s));
    }
    function setCap(uint256 c) external onlyRole(DEFAULT_ADMIN_ROLE) { cap = c; }

    function invest(uint256 amount) external onlyRole(ALLOCATOR_ROLE) nonReentrant {
        if (address(strategy) == address(0)) revert NoStrategy();
        if (invested + amount > cap) revert OverCap();
        invested += amount;
        token.forceApprove(address(strategy), amount);
        strategy.deposit(amount);
        emit Invested(amount);
    }

    /// @notice Pull funds back from the strategy. Works for any allocator at any time.
    function divest(uint256 amount) external onlyRole(ALLOCATOR_ROLE) nonReentrant {
        uint256 got = strategy.withdraw(amount);
        invested = amount >= invested ? 0 : invested - amount;
        emit Divested(got);
    }

    function returnToTreasury(uint256 amount) external onlyRole(ALLOCATOR_ROLE) nonReentrant {
        token.safeTransfer(treasury, amount); emit ReturnedToTreasury(amount);
    }

    function totalValue() external view returns (uint256) { return token.balanceOf(address(this)) + strategy.totalAssets(); }
}

/// @title MockStrategy: pays a fixed rate per second out of a pre-funded reserve. Nothing is minted.
contract MockStrategy is IYieldStrategy, AccessControl {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;
    address public immutable adapter;
    uint256 public aprBps = 800;
    uint256 public principal; uint256 public lastAccrual; uint256 public accrued; uint256 public reserve;
    event ReserveFunded(uint256 amount);

    constructor(address admin, IERC20 token_, address adapter_) { token = token_; adapter = adapter_; lastAccrual = block.timestamp; _grantRole(DEFAULT_ADMIN_ROLE, admin); }

    function fundReserve(uint256 amount) external { token.safeTransferFrom(msg.sender, address(this), amount); reserve += amount; emit ReserveFunded(amount); }

    function _pending() private view returns (uint256) {
        uint256 y = (principal * aprBps * (block.timestamp - lastAccrual)) / (365 days * 10_000);
        uint256 left = reserve > accrued ? reserve - accrued : 0;
        return y > left ? left : y;
    }
    function _accrue() private { accrued += _pending(); lastAccrual = block.timestamp; }

    function deposit(uint256 amount) external { require(msg.sender == adapter, "adapter"); _accrue(); token.safeTransferFrom(msg.sender, address(this), amount); principal += amount; }
    function withdraw(uint256 amount) external returns (uint256 out) {
        require(msg.sender == adapter, "adapter"); _accrue();
        if (amount > principal) amount = principal;
        uint256 y = principal == 0 ? 0 : (accrued * amount) / principal;
        principal -= amount; accrued -= y; reserve -= y;
        out = amount + y;
        token.safeTransfer(adapter, out);
    }
    function totalAssets() external view returns (uint256) { return principal + accrued + _pending(); }
}
