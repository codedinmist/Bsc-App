import { BaseError, ContractFunctionRevertedError, InsufficientFundsError, UserRejectedRequestError } from "viem";

const MESSAGES: Record<string, string> = {
  CooldownActive: "You already claimed recently. Please come back after the cooldown.",
  WalletLimitReached: "This wallet has reached its limit for adding free money.",
  FaucetEmpty: "The faucet is empty right now. Please try later.",
  EnforcedPause: "This feature is paused for safety. Withdrawals stay available.",
  AlreadyRegistered: "You have already joined.",
  NotRegistered: "Join JanSetu first (one quick step on the Home screen).",
  KycRequired: "Your identity check (KYC) is not done yet. Open Home and tap Verify identity.",
  NotOwner: "This account belongs to another wallet.",
  NotActive: "This account is already closed.",
  NotMatured: "This has not reached its maturity date yet.",
  AlreadyMatured: "This has already matured. Use Claim instead.",
  TooEarly: "Early withdrawal is not open yet.",
  CollateralLocked: "Part of this deposit is pledged for a loan.",
  UnsupportedToken: "This token is not supported.",
  TierNotAvailable: "That amount is not an available plan.",
  BelowMinimum: "The amount is below the minimum.",
  InvalidDay: "That day cannot be paid yet.",
  AlreadyPaid: "That instalment is already paid.",
  PlanNotAvailable: "That plan is not available.",
  InvalidInstallment: "That instalment is not due yet.",
  TermNotAvailable: "That term is not available.",
  RewardNotFunded: "The reward pool cannot fully fund this reward right now.",
  EarlyWithdrawalDisabled: "Early withdrawal is turned off for fixed deposits.",
  ZeroAmount: "Enter an amount greater than zero.",
  InsufficientFreeStake: "Not enough free stake. Part of your stake is locked in open orders.",
  NotUnlocked: "Your unstake delay is not over yet.",
  NothingPending: "Nothing is waiting to be withdrawn.",
  NotEligible: "This wallet or account is not eligible for that.",
  BadParam: "Those details are not valid. Check the agent address, amount and time.",
  NotParticipant: "Only the other person in this order can do that.",
  BadStatus: "This order is no longer open.",
  Expired: "This has expired.",
  AmountOutOfRange: "Amount must be between 10 and 100,000 tINR.",
  NotAgent: "That wallet is not an active, verified agent.",
  AgentNotStaked: "The agent's stake is below the minimum.",
  NotVerified: "An agent must verify you first, and the check lasts 14 days.",
  HasLoan: "You already have an active loan.",
  Defaulted: "A previous loan was defaulted, so new loans are blocked.",
  BadPosition: "This daily account does not qualify (needs 15 deposits of 100+ tINR and not used before).",
  TooMany: "That is more instalments than remain.",
  NotYetDefault: "This loan is not late enough to be marked in default.",
  PledgeShort: "Pledge more of your deposit first.",
  OverLtv: "That is more than the allowed share of your collateral.",
  BadTerm: "Choose a term between 7 and 365 days.",
  NotDue: "This loan is not overdue yet.",
  OverOwed: "That is more than you owe.",
  NoLiquidity: "The pool does not have enough free cash right now. Try a smaller amount.",
  NotEnoughShares: "You do not hold that many pool shares.",
  AlreadyReferred: "You have already chosen an agent.",
  SelfReferral: "You cannot choose yourself.",
  NothingToSync: "Nothing new to count for this deposit.",
  NothingToClaim: "Nothing is available to claim yet.",
  TooYoung: "This deposit needs to be at least 30 days old for the bonus.",
  AlreadyClaimed: "You already claimed this.",
  PoolShort: "The reward pool is empty right now. Try again after it is topped up.",
  AlreadyEntered: "You are already entered this week.",
  WeekNotOver: "The week is not over yet.",
  TooSoon: "Wait a few more blocks and try again.",
  AlreadyDone: "This draw is already done.",
  NoCommit: "Start the draw first.",
  Full: "This week's draw is full.",
  HasOpenClaim: "You already have a claim being reviewed.",
  Cooldown: "A claim was paid recently. Please wait for the cooldown.",
  NotBorrower: "That loan is not yours.",
  OverLine: "The loan pool has reached its limit right now.",
  OverUtilisation: "The loan pool has no free capacity right now.",
  NotReady: "The numbers for that step are not reached yet.",
  AlreadyHeaded: "That area already has a head.",
  NoLeader: "Nobody in that area has counted volume yet.",
  NotActiveAgent: "Only verified, active agents can be counted.",
  NotCompleted: "That order or loan is not finished yet.",
  NoAgent: "No agent is linked to that order or loan.",
  NothingToPay: "Nothing is due to be paid right now.",
  AgentNotEligible: "That agent has not met every rule yet (KYC, stake, own savings and two referrals).",
  InsufficientUnlocked: "Not enough unpledged balance.",
};

export function friendlyError(err: unknown): string {
  if (err instanceof BaseError) {
    const rejected = err.walk((e) => e instanceof UserRejectedRequestError);
    if (rejected) return "You cancelled the request.";
    if (err.walk((e) => e instanceof InsufficientFundsError)) return "You need a little BNB for the network fee. You can get some free from the BNB faucet.";
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name && MESSAGES[name]) return MESSAGES[name];
      if (name) return `The contract refused this (${name}).`;
    }
    if (/insufficient funds/i.test(err.message)) return "You need a little BNB for the network fee. You can get some free from the BNB faucet.";
    if (/allowance|exceeds balance|transfer amount/i.test(err.message)) return "Your tINR balance is too low for this.";
  }
  const m = err instanceof Error ? err.message : String(err);
  if (/authentication|biometric|cancel/i.test(m)) return "Authentication was cancelled.";
  if (/blocked: this address/i.test(m)) return m;
  return "Something went wrong. Nothing was sent. Please try again.";
}
