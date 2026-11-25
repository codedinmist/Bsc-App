import { parseAbi } from "viem";

// Human-readable on purpose: every function the app can call is visible here and reviewable in one screen.
export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const transferEvent = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"])[0];

const vaultErrors = [
  "error NotOwner()", "error NotActive()", "error NotRegistered()", "error KycRequired()", "error UnsupportedToken()",
  "error CollateralLocked()", "error NotMatured()", "error AlreadyMatured()", "error TooEarly()", "error ZeroAmount()",
  "error InsufficientUnlocked()", "error EnforcedPause()",
] as const;

const position = "(address owner, uint128 principal, uint128 locked, uint128 rewardReserved, uint128 rewardUnfunded, uint64 openedAt, uint64 maturityAt, bool collateralEligible, uint8 status)";
const vaultCommon = [
  "function idsOf(address owner) view returns (uint256[])",
  `function getPosition(uint256 id) view returns (${position})`,
  "function totalPrincipal() view returns (uint256)",
  "function rewardPool() view returns (uint256)",
  "function totalRewardLiability() view returns (uint256)",
  "function isSolvent() view returns (bool)",
  "function withdrawEarly(uint256 id)",
  "function claim(uint256 id)",
] as const;

export const faucetAbi = parseAbi([
  "function claim()",
  "function claimAmount() view returns (uint256)",
  "function cooldown() view returns (uint256)",
  "function maxPerWallet() view returns (uint256)",
  "function nextClaimAt(address) view returns (uint256)",
  "function totalClaimed(address) view returns (uint256)",
  "error CooldownActive(uint256 availableAt)", "error WalletLimitReached()", "error FaucetEmpty()", "error EnforcedPause()",
]);

export const registryAbi = parseAbi([
  "function register()",
  "function isRegistered(address) view returns (bool)",
  "function isKyc(address) view returns (bool)",
  "function isActiveAgent(address) view returns (bool)",
  "function roleOf(address) view returns (uint8)",
  "function profileOf(address) view returns ((uint8 role, bool kycVerified, bool agentVerified, bool suspended, uint32 clusterId, uint32 districtId, uint32 stateId, uint64 registeredAt))",
  "error AlreadyRegistered()",
]);

export const dailyAbi = parseAbi([
  ...vaultCommon, ...vaultErrors,
  "function open(uint256 installment) returns (uint256)",
  "function deposit(uint256 id, uint16 dayIndex)",
  "function accounts(uint256) view returns (uint128 installment, uint16 totalDays, uint16 paidCount, uint32 earlyAfterDays, uint16 earlyPenaltyBps, uint16 rewardBps)",
  "function paid(uint256 id, uint16 dayIndex) view returns (bool)",
  "function tierEnabled(uint256) view returns (bool)",
  "error TierNotAvailable()", "error BelowMinimum()", "error InvalidDay()", "error AlreadyPaid()",
]);

export const rdAbi = parseAbi([
  ...vaultCommon, ...vaultErrors,
  "function open(uint256 planId) returns (uint256)",
  "function pay(uint256 id, uint16 index)",
  "function planCount() view returns (uint256)",
  "function plans(uint256) view returns (uint128 monthly, uint16 months, uint16 rewardBps, bool enabled)",
  "function accounts(uint256) view returns (uint128 monthly, uint16 months, uint16 paidCount, uint16 onTimeCount, uint16 rewardBps, uint16 graceDays, uint16 latePenaltyBps, uint16 earlyPenaltyBps, uint16 loyaltyBps, uint32 earlyAfterDays)",
  "function paid(uint256 id, uint16 index) view returns (bool)",
  "function missedCount(uint256 id) view returns (uint256)",
  "error PlanNotAvailable()", "error InvalidInstallment()", "error AlreadyPaid()",
]);

export const fdAbi = parseAbi([
  ...vaultCommon, ...vaultErrors,
  "function open(uint256 termId, uint256 amount, bool requireFundedReward) returns (uint256)",
  "function termCount() view returns (uint256)",
  "function terms(uint256) view returns (uint32 durationDays, uint16 rewardBps, bool enabled)",
  "function deposits(uint256) view returns (uint16 termId, uint16 earlyPenaltyBps, bool earlyAllowed)",
  "error TermNotAvailable()", "error BelowMinimum()", "error RewardNotFunded()", "error EarlyWithdrawalDisabled()",
]);

// ---------------------------------------------------------------- Phase 4
export const stakingAbi = parseAbi([
  "function stake(uint256 amount)", "function requestUnstake(uint256 amount)", "function withdraw()",
  "function accounts(address) view returns (uint256 staked, uint256 reserved, uint256 pending, uint64 unlockAt)",
  "function isEligible(address) view returns (bool)", "function minStake() view returns (uint256)", "function freeStake(address) view returns (uint256)",
  "error InsufficientFreeStake()", "error NotUnlocked()", "error NothingPending()", "error ZeroAmount()", "error EnforcedPause()",
]);

export const escrowAbi = parseAbi([
  "function createOrder(uint8 kind, address counterparty, uint256 amount, uint64 window) returns (uint256)",
  "function release(uint256 id)", "function refund(uint256 id)", "function openDispute(uint256 id, bytes32 evidenceHash)", "function appeal(uint256 id)",
  "function orders(uint256) view returns (address locker, address beneficiary, uint128 amount, uint64 createdAt, uint64 deadline, uint8 kind, uint8 status)",
  "function minAmount() view returns (uint256)", "function maxAmount() view returns (uint256)", "function maxWindow() view returns (uint64)",
  "event OrderCreated(uint256 indexed id, uint8 kind, address indexed locker, address indexed beneficiary, uint256 amount, uint64 deadline)",
  "error BadParam()", "error NotParticipant()", "error NotEligible()", "error BadStatus()", "error TooEarly()", "error Expired()", "error AmountOutOfRange()", "error EnforcedPause()",
]);

export const scoreAbi = parseAbi([
  "function mint()", "function scoreOf(address) view returns (uint256)", "function tokenOf(address) view returns (uint256)",
  "function recordOf(address) view returns ((uint16 score, uint16 onTime, uint16 late, uint16 completed, uint16 defaults))",
]);

const loan = "(address borrower, address verifier, uint128 principal, uint128 totalDue, uint128 installment, uint128 paid, uint128 principalRepaid, uint32 count, uint32 paidCount, uint64 nextDue, uint8 tier, bool reliefUsed, uint8 status)";
export const microAbi = parseAbi([
  "function borrow(uint8 tier, uint256 dailyPositionId) returns (uint256)", "function repay(uint256 id, uint32 n)", "function markDefault(uint256 id)", "function verifyApplicant(address applicant)",
  `function getLoan(uint256 id) view returns (${loan})`, "function activeLoanOf(address) view returns (uint256)", "function completedCount(address) view returns (uint256)",
  "function verifiedBy(address) view returns (address)", "function verifiedAt(address) view returns (uint64)", "function positionUsed(uint256) view returns (bool)", "function hasDefaulted(address) view returns (bool)",
  "function requireKyc() view returns (bool)", "function minScore() view returns (uint256)", "function tier0Principal() view returns (uint256)", "function tier1Principal() view returns (uint256)",
  "error KycRequired()", "error NotAgent()", "error AgentNotStaked()", "error NotVerified()", "error HasLoan()", "error Defaulted()", "error BadPosition()", "error NotEligible()", "error NotActive()", "error NotYetDefault()", "error TooMany()", "error EnforcedPause()",
]);

export const collAbi = parseAbi([
  "function borrow(address vault, uint256 positionId, uint256 collateral, uint256 principal, uint256 termDays) returns (uint256)",
  "function repay(uint256 id, uint256 amount)", "function liquidate(uint256 id)",
  "function getLoan(uint256 id) view returns ((address borrower, address vault, uint256 positionId, uint128 collateral, uint128 principal, uint128 owed, uint128 paid, uint128 principalRepaid, uint64 dueAt, uint8 status))",
  "function maxBorrow(uint256 collateral) view returns (uint256)", "function interestFor(uint256 principal, uint256 termDays) view returns (uint256)", "function aprBps() view returns (uint256)", "function ltvBps() view returns (uint256)",
  "event Borrowed(uint256 indexed id, address indexed borrower, address vault, uint256 positionId, uint256 collateral, uint256 principal, uint256 owed, uint64 dueAt)",
  "error BadVault()", "error NotOwner()", "error PledgeShort()", "error OverLtv()", "error BadTerm()", "error NotActive()", "error NotDue()", "error OverOwed()", "error EnforcedPause()",
]);

export const vaultPledgeAbi = parseAbi(["function pledge(uint256 id, uint256 amount, address pledgee)", "function pledgedTo(uint256 id, address pledgee) view returns (uint128)"]);

export const poolAbi = parseAbi([
  "function deposit(uint256 amount) returns (uint256)", "function withdraw(uint256 shareAmount) returns (uint256)",
  "function shares(address) view returns (uint256)", "function lpValue(address) view returns (uint256)", "function totalAssets() view returns (uint256)", "function outstanding() view returns (uint256)", "function idle() view returns (uint256)",
  "error NoLiquidity()", "error NotEnoughShares()", "error Zero()", "error EnforcedPause()",
]);

export const commissionsAbi = parseAbi([
  "function setReferrer(address agent)", "function sync(address vault, uint256 id)", "function claim(address vault, uint256 id, uint8 slot)",
  "function referrerOf(address) view returns (address)", "function agentVolume(address) view returns (uint256)", "function monthAccounts(address, uint256) view returns (uint256)",
  "function claimable(address vault, uint256 id, uint8 slot) view returns (uint256)", "function pool() view returns (uint256)",
  "function referralCount(address) view returns (uint256)", "function isBoosted(address vault, uint256 id) view returns (bool)", "function boostBps() view returns (uint16)",
  "error NotAgent()", "error AlreadyReferred()", "error NotRegistered()", "error NothingToSync()", "error NothingToClaim()", "error SelfReferral()", "error Cancelled_()",
]);

export const rewardsAbi = parseAbi([
  "function claimAccountBonus(address vault, uint256 id)", "function claimBooster(uint256 month)", "function claimMilestone(uint256 index)",
  "function bonusClaimed(bytes32) view returns (bool)", "function milestones(uint256) view returns (uint256 volume, uint256 reward)", "function milestoneCount() view returns (uint256)",
  "function milestoneClaimed(address, uint256) view returns (bool)", "function pool() view returns (uint256)",
  "error NotOwner()", "error NotActive()", "error TooYoung()", "error NotEligible()", "error AlreadyClaimed()", "error PoolShort()",
]);

export const jackpotAbi = parseAbi([
  "function enter()", "function commitDraw(uint256 week)", "function reveal(uint256 week)", "function claim(uint256 week)",
  "function weekNow() view returns (uint256)", "function entered(uint256, address) view returns (bool)", "function prize(uint256, address) view returns (uint256)",
  "function draws(uint256) view returns (uint64 commitBlock, bool done, uint32 winners)", "function entrantCount(uint256) view returns (uint256)", "function pool() view returns (uint256)", "function savingsOf(address) view returns (uint256)", "function minSavings() view returns (uint256)",
  "error WeekNotOver()", "error AlreadyEntered()", "error NotEligible()", "error Full()", "error NoCommit()", "error TooSoon()", "error Expired()", "error AlreadyDone()", "error NothingToClaim()",
]);

export const insuranceAbi = parseAbi([
  "function fileClaim(uint8 kind, uint256 requested, uint256 loanId, bytes32 evidence) returns (uint256)",
  "function isCovered(address) view returns (bool)", "function savingsOf(address) view returns (uint256)", "function openClaimOf(address) view returns (uint256)", "function coverCap() view returns (uint256)", "function minSavings() view returns (uint256)", "function pool() view returns (uint256)",
  "function getClaim(uint256) view returns ((address user, uint8 kind, uint256 requested, uint256 loanId, bytes32 evidence, uint8 status, uint256 paid, uint64 filedAt))",
  "error NotEligible()", "error HasOpenClaim()", "error Cooldown()", "error NotBorrower()", "error BadParam()",
]);

// ---------------------------------------------------------------- Phase 5: ranks, service commissions, governance
export const ranksAbi = parseAbi([
  "function isAgentEligible(address) view returns (bool)", "function ownInvestment(address) view returns (uint256)", "function kycReferrals(address) view returns (uint256)",
  "function ownInvestmentMin() view returns (uint256)", "function referralsMin() view returns (uint16)", "function rankOf(address) view returns (uint8)",
  "function tracked(address) view returns (bool)", "function seenVolume(address) view returns (uint256)", "function syncAgent(address)",
  "function promoteCluster(uint32)", "function promoteDistrict(uint32)", "function promoteState(uint32)",
  "function clusterHead(uint32) view returns (address)", "function districtHead(uint32) view returns (address)", "function stateHead(uint32) view returns (address)",
  "function clusterAgents(uint32) view returns (uint16)", "function clusterVolume(uint32) view returns (uint256)", "function districtVolume(uint32) view returns (uint256)", "function stateVolume(uint32) view returns (uint256)",
  "function clustersInDistrict(uint32) view returns (uint16)", "function districtsInState(uint32) view returns (uint16)", "function clusterDistrict(uint32) view returns (uint32)", "function districtState(uint32) view returns (uint32)",
  "function clusterAgentsMin() view returns (uint16)", "function clusterVolumeMin() view returns (uint256)", "function districtClustersMin() view returns (uint16)", "function districtVolumeMin() view returns (uint256)", "function stateDistrictsMin() view returns (uint16)", "function stateVolumeMin() view returns (uint256)",
  "error NotActiveAgent()", "error NotReady()", "error AlreadyHeaded()", "error NoHead()", "error NoLeader()",
]);

export const serviceAbi = parseAbi([
  "function syncP2P(uint256 orderId)", "function syncLoan(uint256 loanId)", "function sweepPrediction()", "function payDistrict(uint32 districtId)",
  "function districtPending(uint32) view returns (uint256)", "function pool() view returns (uint256)", "function districtOwed() view returns (uint256)", "function isSolvent() view returns (bool)",
  "function p2pPaid(uint256) view returns (bool)", "function loanOpenPaid(uint256) view returns (bool)", "function recoveryBasis(uint256) view returns (uint256)",
  "function p2pAgentBps() view returns (uint16)", "function recoveryAgentBps() view returns (uint16)", "function clusterLoanBps() view returns (uint16)", "function stateTurnoverBps() view returns (uint16)", "function districtShareBps() view returns (uint16)",
  "error PoolShort()", "error NothingToPay()", "error NotCompleted()", "error NoAgent()",
]);

export const multisigAbi = parseAbi([
  "function owners() view returns (address[])", "function threshold() view returns (uint256)", "function txCount() view returns (uint256)",
  "function validConfirmations(uint256) view returns (uint256)",
  "function getTx(uint256) view returns ((address to, uint256 value, bytes data, bool executed, uint32 confirmations, uint64 createdAt))",
]);
export const timelockAbi = parseAbi(["function getMinDelay() view returns (uint256)"]);
export const treasuryAbi = parseAbi(["function dailyCap() view returns (uint256)"]);

export const receiptsAbi = parseAbi([
  "event ReceiptIssued(uint256 indexed receiptId, address indexed to, uint8 kind, address indexed source, uint256 refId, uint256 amount)",
  "function receiptOf(uint256 id) view returns ((uint8 kind, address source, uint256 refId, uint256 amount, uint64 timestamp, uint64 blockNumber))",
]);
