// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {JanSetuRegistry} from "../core/JanSetuRegistry.sol";
import {DigitalReceiptNFT} from "../core/DigitalReceiptNFT.sol";
import {IVault} from "../interfaces/IVault.sol";
import {ILoanPool, ICreditScore} from "../interfaces/ILoanPool.sol";

/// @title Loans against savings (deck slide 5: up to 80% of Daily / RD / FD).
/// @dev The borrower first pledges part of a position to this contract in the vault (owner-only call), then borrows.
///      Both loan and collateral are tINR, so no price oracle exists. The vault refuses withdrawal while locked.
///      After due date + grace anyone can liquidate: only the amount owed is seized, the rest is released to the owner.
///      Total owed (principal + fixed interest) is capped at 95% of the collateral, so a seizure always covers it.
contract CollateralLoan is AccessControl, Pausable, ReentrancyGuard, ERC2771Context {
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint256 internal constant BPS = 10_000;

    enum Status { None, Active, Repaid, Liquidated }
    struct Loan {
        address borrower; address vault; uint256 positionId; uint128 collateral; uint128 principal; uint128 owed; uint128 paid; uint128 principalRepaid; uint64 dueAt; Status status;
    }

    IERC20 public immutable token;
    ILoanPool public immutable pool;
    ICreditScore public immutable score;
    DigitalReceiptNFT public immutable receipts;

    uint256 public nextLoanId = 1;
    mapping(uint256 => Loan) private _loans;
    mapping(address => bool) public allowedVault;
    mapping(address => mapping(uint256 => uint128)) public usedCollateral; // vault => position => collateral backing loans
    uint256 public ltvBps = 8000; uint256 public aprBps = 1200; uint64 public grace = 3 days;
    uint256 public minTerm = 7; uint256 public maxTerm = 365;
    /// @notice When set, a borrower must be KYC-verified in this registry (deck slide 7). Zero address = off.
    JanSetuRegistry public kycRegistry;
    event KycRegistrySet(address registry);

    event Borrowed(uint256 indexed id, address indexed borrower, address vault, uint256 positionId, uint256 collateral, uint256 principal, uint256 owed, uint64 dueAt);
    event Repaid(uint256 indexed id, address indexed payer, uint256 amount, bool closed);
    event Liquidated(uint256 indexed id, address indexed by, uint256 seized, uint256 returned);

    error KycRequired(); error BadVault(); error NotOwner(); error PledgeShort(); error OverLtv(); error BadTerm(); error NotActive(); error NotDue(); error OverOwed();

    constructor(address admin, IERC20 token_, ILoanPool pool_, ICreditScore score_, DigitalReceiptNFT receipts_, address forwarder) ERC2771Context(forwarder) {
        token = token_; pool = pool_; score = score_; receipts = receipts_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin); _grantRole(PAUSER_ROLE, admin);
        token_.forceApprove(address(pool_), type(uint256).max);
    }

    function setKycRegistry(address r) external onlyRole(DEFAULT_ADMIN_ROLE) { kycRegistry = JanSetuRegistry(r); emit KycRegistrySet(r); }
    function setVault(address v, bool ok) external onlyRole(DEFAULT_ADMIN_ROLE) { allowedVault[v] = ok; }
    function setTerms(uint256 ltv, uint256 apr, uint64 grace_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(ltv <= 8000 && ltv >= 1000 && apr <= 3000 && grace_ <= 14 days, "bounds");
        ltvBps = ltv; aprBps = apr; grace = grace_;
    }
    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    /// @notice Max loan for a given amount of collateral.
    function maxBorrow(uint256 collateral) public view returns (uint256) { return (collateral * ltvBps) / BPS; }
    function interestFor(uint256 principal, uint256 termDays) public view returns (uint256) { return (principal * aprBps * termDays) / (365 * BPS); }

    function borrow(address vault, uint256 positionId, uint256 collateral, uint256 principal, uint256 termDays) external nonReentrant whenNotPaused returns (uint256 id) {
        if (!allowedVault[vault]) revert BadVault();
        if (address(kycRegistry) != address(0) && !kycRegistry.isKyc(_msgSender())) revert KycRequired();
        if (termDays < minTerm || termDays > maxTerm) revert BadTerm();
        IVault v = IVault(vault);
        IVault.Position memory p = v.getPosition(positionId);
        if (p.owner != _msgSender()) revert NotOwner();
        if (uint256(v.pledgedTo(positionId, address(this))) < uint256(usedCollateral[vault][positionId]) + collateral) revert PledgeShort();
        if (principal == 0 || principal > maxBorrow(collateral)) revert OverLtv();
        uint256 owed = principal + interestFor(principal, termDays);
        if (owed > (collateral * 9500) / BPS) revert OverLtv();

        usedCollateral[vault][positionId] += uint128(collateral);
        id = nextLoanId++;
        uint64 due = uint64(block.timestamp + termDays * 1 days);
        _loans[id] = Loan(_msgSender(), vault, positionId, uint128(collateral), uint128(principal), uint128(owed), 0, 0, due, Status.Active);
        pool.lend(_msgSender(), principal);
        emit Borrowed(id, _msgSender(), vault, positionId, collateral, principal, owed, due);
    }

    /// @notice Repay any part (anyone may pay for the borrower). Works while paused. Full repayment frees the collateral.
    function repay(uint256 id, uint256 amount) external nonReentrant {
        Loan storage l = _loans[id];
        if (l.status != Status.Active) revert NotActive();
        if (amount > l.owed - l.paid) revert OverOwed();
        uint256 prin = amount == l.owed - l.paid ? l.principal - l.principalRepaid : (amount * l.principal) / l.owed;
        l.paid += uint128(amount); l.principalRepaid += uint128(prin);
        token.safeTransferFrom(_msgSender(), address(this), amount);
        pool.repay(prin, amount - prin);
        bool closed = l.paid == l.owed;
        if (closed) {
            l.status = Status.Repaid;
            usedCollateral[l.vault][l.positionId] -= l.collateral;
            IVault(l.vault).release(l.positionId, l.collateral);
            bool onTime = block.timestamp <= uint256(l.dueAt) + grace;
            if (onTime) score.recordOnTime(l.borrower); else score.recordLate(l.borrower);
            score.recordCompleted(l.borrower);
            try receipts.issue(l.borrower, DigitalReceiptNFT.Kind.LoanCompletion, id, l.principal) {} catch {}
        }
        emit Repaid(id, _msgSender(), amount, closed);
    }

    function liquidate(uint256 id) external nonReentrant {
        Loan storage l = _loans[id];
        if (l.status != Status.Active) revert NotActive();
        if (block.timestamp <= uint256(l.dueAt) + grace) revert NotDue();
        uint256 remaining = l.owed - l.paid;
        uint256 seize = remaining > l.collateral ? l.collateral : remaining;
        uint256 prinLeft = l.principal - l.principalRepaid;
        uint256 prin = seize == remaining ? prinLeft : (seize * prinLeft) / remaining;
        l.status = Status.Liquidated;
        usedCollateral[l.vault][l.positionId] -= l.collateral;
        IVault(l.vault).seize(l.positionId, seize, address(this));
        pool.repay(prin, seize - prin);
        if (prinLeft > prin) pool.writeOff(prinLeft - prin);
        uint256 back = l.collateral - seize;
        if (back > 0) IVault(l.vault).release(l.positionId, back);
        score.recordDefault(l.borrower);
        emit Liquidated(id, _msgSender(), seize, back);
    }

    /// @notice Frees collateral you pledged here but did not borrow against (for example if the borrow step failed).
    ///         Works while paused. Cannot touch collateral that backs an open loan.
    function releaseUnused(address vault, uint256 positionId, uint256 amount) external nonReentrant {
        if (!allowedVault[vault]) revert BadVault();
        IVault v = IVault(vault);
        if (v.getPosition(positionId).owner != _msgSender()) revert NotOwner();
        uint256 free = uint256(v.pledgedTo(positionId, address(this))) - uint256(usedCollateral[vault][positionId]);
        if (amount == 0 || amount > free) revert PledgeShort();
        v.release(positionId, amount);
    }

    function getLoan(uint256 id) external view returns (Loan memory) { return _loans[id]; }

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) { return ERC2771Context._msgSender(); }
    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) { return ERC2771Context._msgData(); }
    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) { return ERC2771Context._contextSuffixLength(); }
}
