// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVault} from "../interfaces/IVault.sol";

interface IRelief { function grantRelief(uint256 loanId) external; function getLoanBorrower(uint256 id) external view returns (address); }

/// @title Insurance pool (deck slides 4 and 10): accident cover and 30-day EMI relief.
/// @dev Cover applies to wallets holding at least `minSavings` (deck: 50,000 tINR) in active deposits.
///      Claims are decided by CLAIMS_ROLE (an operations multisig, never a single key); payouts are capped per claim and
///      by the pool balance, and a wallet can be paid once per `cooldown`. This is a discretionary testnet fund, not a regulated insurance product.
contract InsurancePool is AccessControl, ReentrancyGuard, ERC2771Context {
    using SafeERC20 for IERC20;

    bytes32 public constant CLAIMS_ROLE = keccak256("CLAIMS_ROLE");
    enum Kind { Accident, EmiRelief }
    enum Status { None, Open, Paid, Rejected }
    struct Claim { address user; Kind kind; uint256 requested; uint256 loanId; bytes32 evidence; Status status; uint256 paid; uint64 filedAt; }

    IERC20 public immutable token;
    IVault[] public vaults;
    IRelief public relief;

    uint256 public pool;
    uint256 public minSavings = 50_000e18;
    uint256 public coverCap = 200_000e18;
    uint64 public cooldown = 365 days;
    uint256 public nextClaimId = 1;
    mapping(uint256 => Claim) private _claims;
    mapping(address => uint256) public openClaimOf;
    mapping(address => uint64) public lastPaidAt;

    event Funded(address indexed from, uint256 amount);
    event ClaimFiled(uint256 indexed id, address indexed user, Kind kind, uint256 requested);
    event ClaimDecided(uint256 indexed id, bool approved, uint256 paid);

    error NotEligible(); error HasOpenClaim(); error Cooldown(); error NotOpen(); error NotBorrower(); error BadParam();

    constructor(address admin, IERC20 token_, IVault[] memory vaults_, IRelief relief_, address forwarder) ERC2771Context(forwarder) {
        token = token_; relief = relief_;
        for (uint256 i; i < vaults_.length; ++i) vaults.push(vaults_[i]);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function setParams(uint256 minSavings_, uint256 coverCap_, uint64 cooldown_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (coverCap_ > 1_000_000e18 || cooldown_ < 30 days) revert BadParam();
        minSavings = minSavings_; coverCap = coverCap_; cooldown = cooldown_;
    }

    function fund(uint256 amount) external nonReentrant {
        uint256 b = token.balanceOf(address(this));
        token.safeTransferFrom(_msgSender(), address(this), amount);
        require(token.balanceOf(address(this)) - b == amount, "fee on transfer");
        pool += amount; emit Funded(_msgSender(), amount);
    }

    function savingsOf(address u) public view returns (uint256 total) {
        for (uint256 v; v < vaults.length; ++v) {
            uint256[] memory ids = vaults[v].idsOf(u);
            uint256 start = ids.length > 25 ? ids.length - 25 : 0;
            for (uint256 i = start; i < ids.length; ++i) {
                IVault.Position memory p = vaults[v].getPosition(ids[i]);
                if (p.status == IVault.Status.Active) total += p.principal;
            }
        }
    }

    function isCovered(address u) public view returns (bool) { return savingsOf(u) >= minSavings; }

    function fileClaim(Kind kind, uint256 requested, uint256 loanId, bytes32 evidence) external returns (uint256 id) {
        if (!isCovered(_msgSender())) revert NotEligible();
        if (openClaimOf[_msgSender()] != 0) revert HasOpenClaim();
        if (lastPaidAt[_msgSender()] != 0 && block.timestamp < uint256(lastPaidAt[_msgSender()]) + cooldown) revert Cooldown();
        if (kind == Kind.EmiRelief && relief.getLoanBorrower(loanId) != _msgSender()) revert NotBorrower();
        if (kind == Kind.Accident && (requested == 0 || requested > coverCap)) revert BadParam();
        id = nextClaimId++;
        _claims[id] = Claim(_msgSender(), kind, requested, loanId, evidence, Status.Open, 0, uint64(block.timestamp));
        openClaimOf[_msgSender()] = id;
        emit ClaimFiled(id, _msgSender(), kind, requested);
    }

    function decide(uint256 id, bool approve, uint256 amount) external onlyRole(CLAIMS_ROLE) nonReentrant {
        Claim storage c = _claims[id];
        if (c.status != Status.Open) revert NotOpen();
        openClaimOf[c.user] = 0;
        if (!approve) { c.status = Status.Rejected; emit ClaimDecided(id, false, 0); return; }
        uint256 pay;
        if (c.kind == Kind.Accident) {
            pay = amount;
            if (pay > c.requested) pay = c.requested;
            if (pay > coverCap) pay = coverCap;
            if (pay > pool) pay = pool;
        } else {
            relief.grantRelief(c.loanId); // 30-day EMI relief, no tokens move
        }
        c.status = Status.Paid; c.paid = pay; lastPaidAt[c.user] = uint64(block.timestamp);
        if (pay > 0) { pool -= pay; token.safeTransfer(c.user, pay); }
        emit ClaimDecided(id, true, pay);
    }

    function getClaim(uint256 id) external view returns (Claim memory) { return _claims[id]; }
    function isSolvent() external view returns (bool) { return token.balanceOf(address(this)) >= pool; }

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) { return ERC2771Context._msgSender(); }
    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) { return ERC2771Context._msgData(); }
    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) { return ERC2771Context._contextSuffixLength(); }
}
