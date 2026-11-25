// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Prediction-market liquidity (deck slides 4 and 6) - SIMULATED on testnet.
/// @dev LPs deposit tINR and can withdraw it at any time, 1:1: the (mock) market never takes their principal.
///      Trading fees (2% of volume) are split 50/50 between LPs (pro rata) and the protocol sink.
///      On testnet the fees are paid in by MockPredictionMarket from an operator's own tINR, so nothing is created from nothing.
contract PredictionLP is AccessControl, ReentrancyGuard, ERC2771Context {
    using SafeERC20 for IERC20;

    bytes32 public constant FEE_ROLE = keccak256("FEE_ROLE");
    uint256 internal constant ACC = 1e24;

    IERC20 public immutable token;
    address public immutable protocolSink;
    uint256 public totalDeposits;
    uint256 public accPerShare;
    uint256 public unclaimedToLps;
    mapping(address => uint256) public deposited;
    mapping(address => uint256) private _debt;
    mapping(address => uint256) public pending;

    event Deposited(address indexed lp, uint256 amount);
    event Withdrawn(address indexed lp, uint256 amount);
    event FeesReceived(uint256 total, uint256 toLps, uint256 toProtocol);
    event RewardsClaimed(address indexed lp, uint256 amount);

    error Zero(); error TooMuch();

    constructor(address admin, IERC20 token_, address sink, address forwarder) ERC2771Context(forwarder) {
        token = token_; protocolSink = sink; _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert Zero();
        _harvest(_msgSender());
        uint256 b = token.balanceOf(address(this));
        token.safeTransferFrom(_msgSender(), address(this), amount);
        require(token.balanceOf(address(this)) - b == amount, "fee on transfer");
        deposited[_msgSender()] += amount; totalDeposits += amount;
        _debt[_msgSender()] = (deposited[_msgSender()] * accPerShare) / ACC;
        emit Deposited(_msgSender(), amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert Zero();
        if (amount > deposited[_msgSender()]) revert TooMuch();
        _harvest(_msgSender());
        deposited[_msgSender()] -= amount; totalDeposits -= amount;
        _debt[_msgSender()] = (deposited[_msgSender()] * accPerShare) / ACC;
        token.safeTransfer(_msgSender(), amount);
        emit Withdrawn(_msgSender(), amount);
    }

    function claimRewards() external nonReentrant {
        _harvest(_msgSender());
        uint256 a = pending[_msgSender()];
        if (a == 0) revert Zero();
        pending[_msgSender()] = 0; unclaimedToLps -= a;
        token.safeTransfer(_msgSender(), a);
        emit RewardsClaimed(_msgSender(), a);
    }

    function pendingOf(address lp) external view returns (uint256) {
        return pending[lp] + (deposited[lp] * accPerShare) / ACC - _debt[lp];
    }

    function depositFees(uint256 amount) external onlyRole(FEE_ROLE) nonReentrant {
        token.safeTransferFrom(_msgSender(), address(this), amount);
        uint256 toLps = amount / 2;
        if (totalDeposits == 0) toLps = 0; // nobody to pay: all goes to the protocol sink
        uint256 toProto = amount - toLps;
        if (toLps > 0) { accPerShare += (toLps * ACC) / totalDeposits; unclaimedToLps += toLps; }
        token.safeTransfer(protocolSink, toProto);
        emit FeesReceived(amount, toLps, toProto);
    }

    function _harvest(address lp) private {
        uint256 owed = (deposited[lp] * accPerShare) / ACC - _debt[lp];
        if (owed > 0) pending[lp] += owed;
        _debt[lp] = (deposited[lp] * accPerShare) / ACC;
    }

    function isSolvent() external view returns (bool) { return token.balanceOf(address(this)) >= totalDeposits + unclaimedToLps; }

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) { return ERC2771Context._msgSender(); }
    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) { return ERC2771Context._msgData(); }
    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) { return ERC2771Context._contextSuffixLength(); }
}

/// @title MockPredictionMarket: a clearly simulated trade generator. Real fees, fake trades.
contract MockPredictionMarket is AccessControl {
    using SafeERC20 for IERC20;
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    IERC20 public immutable token;
    PredictionLP public immutable lp;
    uint256 public feeBps = 200; // 2%
    uint256 public simulatedVolume;
    event TradeSimulated(uint256 volume, uint256 fee);

    constructor(address admin, IERC20 token_, PredictionLP lp_) { token = token_; lp = lp_; _grantRole(DEFAULT_ADMIN_ROLE, admin); _grantRole(OPERATOR_ROLE, admin); }

    function simulateTrade(uint256 volume) external onlyRole(OPERATOR_ROLE) {
        uint256 fee = (volume * feeBps) / 10_000;
        token.safeTransferFrom(msg.sender, address(this), fee);
        token.forceApprove(address(lp), fee);
        lp.depositFees(fee);
        simulatedVolume += volume;
        emit TradeSimulated(volume, fee);
    }
}
