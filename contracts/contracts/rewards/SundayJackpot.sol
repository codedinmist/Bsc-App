// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {JanSetuRegistry} from "../core/JanSetuRegistry.sol";
import {IVault} from "../interfaces/IVault.sol";

/// @title Weekly no-loss draw (deck slide 10): up to 100 winners, 500 to 10,000 tINR each.
/// @dev No-loss: tickets cost nothing; prizes come only from a funded pool. To enter, a registered wallet must hold
///      active savings of at least `minSavings` across the listed vaults at entry time.
///      Randomness: commit to a future block, then reveal using its blockhash. This is TESTNET-GRADE: a block producer
///      could bias it slightly. Production must switch to a verifiable randomness service (VRF). Marked Simulated in the app.
contract SundayJackpot is AccessControl, ReentrancyGuard, ERC2771Context {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    JanSetuRegistry public immutable registry;
    IVault[] public vaults;

    uint256 public pool;
    uint256 public reserved;                // prizes drawn but not yet claimed
    uint256 public minSavings = 1_000e18;
    uint256 public maxWinners = 100; uint256 public minPrize = 500e18; uint256 public maxPrize = 10_000e18;
    uint256 public constant MAX_ENTRANTS = 5000;
    uint256 public constant REVEAL_DELAY = 3; // blocks

    struct Draw { uint64 commitBlock; bool done; uint32 winners; }
    mapping(uint256 => address[]) private _entrants;
    mapping(uint256 => mapping(address => bool)) public entered;
    mapping(uint256 => Draw) public draws;
    mapping(uint256 => mapping(address => uint256)) public prize;

    event Funded(address indexed from, uint256 amount);
    event Entered(uint256 indexed week, address indexed user);
    event Committed(uint256 indexed week, uint64 blockNumber);
    event Drawn(uint256 indexed week, uint256 winners, uint256 totalPrizes);
    event PrizeClaimed(uint256 indexed week, address indexed user, uint256 amount);

    error WeekNotOver(); error AlreadyEntered(); error NotEligible(); error Full(); error NoCommit(); error TooSoon(); error Expired(); error AlreadyDone(); error NotEntered(); error NothingToClaim(); error BadParam();

    constructor(address admin, IERC20 token_, JanSetuRegistry registry_, IVault[] memory vaults_, address forwarder) ERC2771Context(forwarder) {
        token = token_; registry = registry_;
        for (uint256 i; i < vaults_.length; ++i) vaults.push(vaults_[i]);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function setParams(uint256 minSavings_, uint256 maxWinners_, uint256 minPrize_, uint256 maxPrize_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (maxWinners_ == 0 || maxWinners_ > 100 || minPrize_ == 0 || minPrize_ > maxPrize_) revert BadParam();
        minSavings = minSavings_; maxWinners = maxWinners_; minPrize = minPrize_; maxPrize = maxPrize_;
    }

    function weekNow() public view returns (uint256) { return block.timestamp / 7 days; }

    function fund(uint256 amount) external nonReentrant {
        uint256 b = token.balanceOf(address(this));
        token.safeTransferFrom(_msgSender(), address(this), amount);
        require(token.balanceOf(address(this)) - b == amount, "fee on transfer");
        pool += amount; emit Funded(_msgSender(), amount);
    }

    function savingsOf(address u) public view returns (uint256 total) {
        for (uint256 v; v < vaults.length; ++v) {
            uint256[] memory ids = vaults[v].idsOf(u);
            uint256 start = ids.length > 25 ? ids.length - 25 : 0; // bounded scan
            for (uint256 i = start; i < ids.length; ++i) {
                IVault.Position memory p = vaults[v].getPosition(ids[i]);
                if (p.status == IVault.Status.Active) total += p.principal;
            }
        }
    }

    function enter() external {
        uint256 w = weekNow();
        if (entered[w][_msgSender()]) revert AlreadyEntered();
        if (!registry.isRegistered(_msgSender()) || savingsOf(_msgSender()) < minSavings) revert NotEligible();
        if (_entrants[w].length >= MAX_ENTRANTS) revert Full();
        entered[w][_msgSender()] = true; _entrants[w].push(_msgSender());
        emit Entered(w, _msgSender());
    }

    function entrantCount(uint256 week) external view returns (uint256) { return _entrants[week].length; }

    /// @notice Step 1 (anyone), after the week has ended.
    function commitDraw(uint256 week) external {
        if (week >= weekNow()) revert WeekNotOver();
        Draw storage d = draws[week];
        if (d.done) revert AlreadyDone();
        // allow a re-commit only if the previous reveal window (250 blocks) was missed
        if (d.commitBlock != 0 && block.number <= uint256(d.commitBlock) + REVEAL_DELAY + 250) revert TooSoon();
        d.commitBlock = uint64(block.number);
        emit Committed(week, d.commitBlock);
    }

    /// @notice Step 2 (anyone), a few blocks later and within 250 blocks of the commit.
    function reveal(uint256 week) external nonReentrant {
        Draw storage d = draws[week];
        if (d.done) revert AlreadyDone();
        if (d.commitBlock == 0) revert NoCommit();
        uint256 target = uint256(d.commitBlock) + REVEAL_DELAY;
        if (block.number <= target) revert TooSoon();
        if (block.number > target + 250) revert Expired();
        bytes32 seed = keccak256(abi.encode(blockhash(target), week, address(this)));

        address[] storage list = _entrants[week];
        uint256 n = list.length;
        uint256 want = n < maxWinners ? n : maxWinners;
        uint256 given; uint256 total; uint256 steps = (maxPrize - minPrize) / 500e18 + 1;
        for (uint256 i; given < want && i < want * 4; ++i) {
            seed = keccak256(abi.encode(seed, i));
            address w = list[uint256(seed) % n];
            if (prize[week][w] != 0) continue;
            uint256 amt = minPrize + (uint256(keccak256(abi.encode(seed, "p"))) % steps) * 500e18;
            if (amt > maxPrize) amt = maxPrize;
            if (pool < amt) break; // never promise more than the funded pool holds
            pool -= amt; reserved += amt; total += amt;
            prize[week][w] = amt; ++given;
        }
        d.done = true; d.winners = uint32(given);
        emit Drawn(week, given, total);
    }

    function claim(uint256 week) external nonReentrant {
        uint256 amt = prize[week][_msgSender()];
        if (amt == 0) revert NothingToClaim();
        prize[week][_msgSender()] = 0; reserved -= amt;
        token.safeTransfer(_msgSender(), amt);
        emit PrizeClaimed(week, _msgSender(), amt);
    }

    function isSolvent() external view returns (bool) { return token.balanceOf(address(this)) >= pool + reserved; }

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) { return ERC2771Context._msgSender(); }
    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) { return ERC2771Context._msgData(); }
    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) { return ERC2771Context._contextSuffixLength(); }
}
