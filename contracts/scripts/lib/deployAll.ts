import { ethers } from "hardhat";
import type { Signer } from "ethers";

export const E = (n: string | number) => ethers.parseEther(n.toString());
export const k = (s: string) => ethers.keccak256(ethers.toUtf8Bytes(s));

export interface DeployOptions {
  guardian?: string; slashSink?: string;
  admin: Signer;
  initialHolder?: string;
  initialSupply?: bigint;
  cap?: bigint;
  /** Apply the deck's projected reward targets as bps (rewards still only pay if the pool is funded). */
  deckRewardTargets?: boolean;
  /** Turn on the deck's KYC rule: deposits, loans and agent verification need KYC. */
  requireKyc?: boolean;
  /** "demo" shrinks the rank thresholds so promotion can be shown on testnet. Default = the deck's numbers. */
  ranksProfile?: "deck" | "demo";
  /** Make the registry ask NetworkRanks before an agent can be verified (KYC, stake, own investment, 2 referrals). */
  enforceAgentRules?: boolean;
}

/** key, min, max, default */
export const CONFIG_KEYS: [string, bigint, bigint, bigint][] = [
  ["REQUIRE_KYC", 0n, 1n, 0n],
  ["DAILY_MIN_DEPOSIT", E(1), E(1000), E(50)],
  ["DAILY_DURATION_DAYS", 30n, 730n, 365n],
  ["DAILY_EARLY_AFTER_DAYS", 1n, 180n, 30n],
  ["DAILY_EARLY_PENALTY_BPS", 0n, 2000n, 0n],
  ["DAILY_REWARD_BPS", 0n, 2000n, 0n],
  ["DAILY_COLLATERAL_ELIGIBLE", 0n, 1n, 1n],
  ["RECEIPT_DAILY", 0n, 1n, 1n],
  ["RD_GRACE_DAYS", 0n, 30n, 5n],
  ["RD_LATE_PENALTY_BPS", 0n, 1000n, 200n],
  ["RD_EARLY_AFTER_DAYS", 0n, 365n, 90n],
  ["RD_EARLY_PENALTY_BPS", 0n, 3000n, 500n],
  ["RD_LOYALTY_BONUS_BPS", 0n, 1000n, 100n],
  ["RD_COLLATERAL_ELIGIBLE", 0n, 1n, 1n],
  ["RECEIPT_RD", 0n, 1n, 1n],
  ["FD_MIN_DEPOSIT", E(1), E(1_000_000), E(1000)],
  ["FD_EARLY_ALLOWED", 0n, 1n, 1n],
  ["FD_EARLY_PENALTY_BPS", 0n, 3000n, 1000n],
  ["FD_COLLATERAL_ELIGIBLE", 0n, 1n, 1n],
  ["RECEIPT_FD", 0n, 1n, 1n],
];

// Deck projection TARGETS, expressed as reward bps. They are NOT guarantees: payable only if the pool is funded.
// Daily 1,750/18,250 = ~9.59%. RD totals from slide 3 (approximated to whole bps). FD 20% / 21.5%^2 / 23%^3 compounding.
export const DECK = {
  dailyRewardBps: 959,
  rdPlans: [
    { monthly: E(1000), months: 12, rewardBps: 950 },
    { monthly: E(2000), months: 36, rewardBps: 3600 },
    { monthly: E(3000), months: 60, rewardBps: 8121 },
    { monthly: E(5000), months: 60, rewardBps: 8121 },
  ],
  fdTerms: [
    { days: 365, rewardBps: 2000 },
    { days: 730, rewardBps: 4762 },
    { days: 1095, rewardBps: 8609 },
  ],
  dailyTiers: [E(50), E(100), E(200), E(500)],
};

export async function deployCore(opts: DeployOptions) {
  const admin = opts.admin;
  const adminAddr = await admin.getAddress();
  const holder = opts.initialHolder ?? adminAddr;

  const args: Record<string, any[]> = {};
  const deploy = async (name: string, a: any[]) => {
    args[name] = a;
    const c = await ethers.deployContract(name, a, admin);
    await c.waitForDeployment();
    return c;
  };
  const forwarder = await deploy("JanSetuForwarder", []);
  const fwdAddr = await forwarder.getAddress();

  const token = await deploy("INRToken", [adminAddr, holder, opts.initialSupply ?? E(100_000_000), opts.cap ?? E(1_000_000_000), fwdAddr]);

  const config = await deploy("ProtocolConfig", [adminAddr]);
  for (const [name, min, max, def] of CONFIG_KEYS) {
    let initial = def;
    if (opts.deckRewardTargets && name === "DAILY_REWARD_BPS") initial = BigInt(DECK.dailyRewardBps);
    if (opts.requireKyc && name === "REQUIRE_KYC") initial = 1n;
    await (await config.defineKey(k(name), min, max, initial)).wait();
  }

  const registry = await deploy("JanSetuRegistry", [adminAddr, fwdAddr]);
  const receipts = await deploy("DigitalReceiptNFT", [adminAddr]);

  const tokenAddr = await token.getAddress();
  const configAddr = await config.getAddress();
  const registryAddr = await registry.getAddress();
  const receiptsAddr = await receipts.getAddress();

  const faucet = await deploy("JanSetuFaucet", [adminAddr, tokenAddr, fwdAddr, E(1000), 24 * 3600, E(10_000)]);
  const common = [adminAddr, fwdAddr, tokenAddr, configAddr, registryAddr, receiptsAddr];
  const daily = await deploy("DailyVault", [...common, DECK.dailyTiers]);
  const rd = await deploy("RecurringDepositVault", common);
  const fd = await deploy("FixedDepositVault", common);

  const issuer = await receipts.ISSUER_ROLE();
  for (const v of [daily, rd, fd]) await (await receipts.grantRole(issuer, await v.getAddress())).wait();

  for (const p of DECK.rdPlans) await (await rd.addPlan(p.monthly, p.months, opts.deckRewardTargets ? p.rewardBps : 0)).wait();
  for (const t of DECK.fdTerms) await (await fd.addTerm(t.days, opts.deckRewardTargets ? t.rewardBps : 0)).wait();

  // Agent stake + P2P escrow. Slashed funds go to slashSink (the treasury / ops Safe on testnet).
  const sink = opts.slashSink ?? adminAddr;
  const staking = await deploy("AgentStaking", [adminAddr, fwdAddr, tokenAddr, E(25_000), 7 * 24 * 3600, sink]);
  const escrow = await deploy("P2PEscrow", [adminAddr, fwdAddr, tokenAddr, registryAddr, await staking.getAddress(), 2 * 3600, 24 * 3600, E(10), E(100_000), 1000]);
  await (await staking.grantRole(await staking.RESERVER_ROLE(), await escrow.getAddress())).wait();
  await (await staking.grantRole(await staking.SLASHER_ROLE(), await escrow.getAddress())).wait();

  // ---------------- Phase 4: treasury, safety, commissions, rewards, credit, pools ----------------
  const guardian = opts.guardian ?? adminAddr;
  const treasury = await deploy("Treasury", [adminAddr, tokenAddr, E(100_000)]);
  const treasuryAddr = await treasury.getAddress();
  const emergency = await deploy("EmergencyController", [adminAddr, guardian]);
  const commissions = await deploy("CommissionManager", [adminAddr, tokenAddr, registryAddr, treasuryAddr, fwdAddr]);
  const rewards = await deploy("RewardsManager", [adminAddr, tokenAddr, await commissions.getAddress(), fwdAddr]);
  const vaultAddrs = [await daily.getAddress(), await rd.getAddress(), await fd.getAddress()];
  for (const [i, a] of vaultAddrs.entries()) {
    await (await commissions.setVault(a, i + 1)).wait();
    await (await rewards.setVault(a, i + 1)).wait();
  }

  const pool = await deploy("LoanLiquidityPool", [adminAddr, tokenAddr, fwdAddr]);
  const score = await deploy("CreditScoreNFT", [adminAddr, fwdAddr]);
  const poolAddr = await pool.getAddress(), scoreAddr = await score.getAddress();
  const micro = await deploy("MicroCredit", [adminAddr, tokenAddr, registryAddr, await staking.getAddress(), poolAddr, scoreAddr, vaultAddrs[0], receiptsAddr, fwdAddr]);
  const coll = await deploy("CollateralLoan", [adminAddr, tokenAddr, poolAddr, scoreAddr, receiptsAddr, fwdAddr]);
  for (const c of [micro, coll]) {
    const a = await c.getAddress();
    await (await pool.grantRole(await pool.BORROWER_ROLE(), a)).wait();
    await (await score.grantRole(await score.SCORER_ROLE(), a)).wait();
    await (await receipts.grantRole(issuer, a)).wait();
  }
  await (await pool.setCreditLine(await micro.getAddress(), E(300_000))).wait();
  await (await pool.setCreditLine(await coll.getAddress(), E(600_000))).wait();
  for (const v of [daily, rd, fd]) {
    await (await v.grantRole(await v.COLLATERAL_ROLE(), await coll.getAddress())).wait();
    await (await coll.setVault(await v.getAddress(), true)).wait();
  }

  const jackpot = await deploy("SundayJackpot", [adminAddr, tokenAddr, registryAddr, vaultAddrs, fwdAddr]);
  const insurance = await deploy("InsurancePool", [adminAddr, tokenAddr, vaultAddrs, await micro.getAddress(), fwdAddr]);
  await (await micro.grantRole(await micro.RELIEF_ROLE(), await insurance.getAddress())).wait();
  if (opts.requireKyc) {
    await (await micro.setRequireKyc(true)).wait();
    await (await coll.setKycRegistry(registryAddr)).wait();
  }

  // Phase 5: ranks, agent eligibility, service commissions (P2P / recovery / cluster / district / state).
  const ranks = await deploy("NetworkRanks", [adminAddr, registryAddr, await staking.getAddress(), await commissions.getAddress(), vaultAddrs]);
  const service = await deploy("ServiceCommission", [adminAddr, tokenAddr, registryAddr, await commissions.getAddress(), await escrow.getAddress(), await micro.getAddress(), treasuryAddr]);
  const ranksAddr = await ranks.getAddress(), serviceAddr = await service.getAddress();
  await (await commissions.grantRole(await commissions.RANKS_ROLE(), ranksAddr)).wait();
  if (opts.enforceAgentRules) await (await registry.setAgentGate(ranksAddr)).wait();
  await (await ranks.setService(serviceAddr)).wait();
  await (await service.setRanks(ranksAddr)).wait();
  if (opts.ranksProfile === "demo") {
    // Testnet demo only: same rules, smaller numbers, so a presenter can show a promotion in minutes.
    await (await ranks.setThresholds(E(500), 2, 2, E(2_000), 2, E(5_000), 2, E(10_000))).wait();
  }
  // Prediction fees: the protocol side is paid into ServiceCommission, which splits it between districts and the DAO.
  const predictionLp = await deploy("PredictionLP", [adminAddr, tokenAddr, serviceAddr, fwdAddr]);
  const predictionMarket = await deploy("MockPredictionMarket", [adminAddr, tokenAddr, await predictionLp.getAddress()]);
  await (await predictionLp.grantRole(await predictionLp.FEE_ROLE(), await predictionMarket.getAddress())).wait();
  const yieldAdapter = await deploy("YieldStrategyAdapter", [adminAddr, tokenAddr, treasuryAddr, E(500_000)]);
  const yieldStrategy = await deploy("MockStrategy", [adminAddr, tokenAddr, await yieldAdapter.getAddress()]);
  await (await yieldAdapter.setStrategy(await yieldStrategy.getAddress())).wait();

  // One-button stop: the controller holds the pauser role on every pausable contract.
  const ecAddr = await emergency.getAddress();
  for (const v of [daily, rd, fd]) await (await v.grantRole(await v.PAUSER_ROLE(), ecAddr)).wait();
  await (await staking.grantRole(await staking.GUARDIAN_ROLE(), ecAddr)).wait();
  await (await escrow.grantRole(await escrow.GUARDIAN_ROLE(), ecAddr)).wait();
  for (const c of [pool, micro, coll]) await (await c.grantRole(await c.PAUSER_ROLE(), ecAddr)).wait();
  for (const c of [daily, rd, fd, staking, escrow, pool, micro, coll]) await (await emergency.addTarget(await c.getAddress())).wait();

  return { forwarder, token, config, registry, receipts, faucet, daily, rd, fd, staking, escrow, treasury, emergency, commissions, rewards, ranks, service, pool, score, micro, coll, jackpot, insurance, predictionLp, predictionMarket, yieldAdapter, yieldStrategy, args };
}

type AC = { DEFAULT_ADMIN_ROLE(): Promise<string>; grantRole(r: string, a: string): Promise<any>; renounceRole(r: string, a: string): Promise<any>; hasRole(r: string, a: string): Promise<boolean>; getAddress(): Promise<string> };

/** Gives governance roles to the timelock / ops / guardian and removes every role from the deployer. */
export async function handOverGovernance(
  c: Awaited<ReturnType<typeof deployCore>>,
  deployer: Signer,
  gov: { timelock: string; ops: string; guardian: string }
) {
  const me = await deployer.getAddress();
  const plan: [any, string, string][] = [
    [c.token, "DEFAULT_ADMIN_ROLE", gov.timelock],
    [c.token, "PAUSER_ROLE", gov.guardian],
    [c.config, "DEFAULT_ADMIN_ROLE", gov.timelock],
    [c.config, "CONFIG_ROLE", gov.timelock],
    [c.registry, "DEFAULT_ADMIN_ROLE", gov.timelock],
    [c.registry, "GOVERNOR_ROLE", gov.timelock],
    [c.registry, "OPERATOR_ROLE", gov.ops],
    [c.receipts, "DEFAULT_ADMIN_ROLE", gov.timelock],
    [c.faucet, "DEFAULT_ADMIN_ROLE", gov.ops],
    [c.faucet, "PAUSER_ROLE", gov.guardian],
  ];
  plan.push(
    [c.staking, "DEFAULT_ADMIN_ROLE", gov.timelock], [c.staking, "GUARDIAN_ROLE", gov.guardian],
    [c.escrow, "DEFAULT_ADMIN_ROLE", gov.timelock], [c.escrow, "GUARDIAN_ROLE", gov.guardian],
    [c.escrow, "GOVERNOR_ROLE", gov.timelock], [c.escrow, "RESOLVER_ROLE", gov.ops],
  );
  for (const v of [c.daily, c.rd, c.fd]) {
    plan.push([v, "DEFAULT_ADMIN_ROLE", gov.timelock], [v, "PAUSER_ROLE", gov.guardian]);
  }
  plan.push(
    [c.treasury, "DEFAULT_ADMIN_ROLE", gov.timelock], [c.treasury, "SPENDER_ROLE", gov.timelock],
    [c.emergency, "DEFAULT_ADMIN_ROLE", gov.timelock], [c.emergency, "GUARDIAN_ROLE", gov.guardian],
    [c.commissions, "DEFAULT_ADMIN_ROLE", gov.timelock], [c.commissions, "GOVERNOR_ROLE", gov.timelock],
    [c.ranks, "DEFAULT_ADMIN_ROLE", gov.timelock], [c.ranks, "GOVERNOR_ROLE", gov.timelock],
    [c.service, "DEFAULT_ADMIN_ROLE", gov.timelock],
    [c.rewards, "DEFAULT_ADMIN_ROLE", gov.timelock],
    [c.pool, "DEFAULT_ADMIN_ROLE", gov.timelock], [c.pool, "PAUSER_ROLE", gov.guardian],
    [c.score, "DEFAULT_ADMIN_ROLE", gov.timelock],
    [c.micro, "DEFAULT_ADMIN_ROLE", gov.timelock], [c.micro, "PAUSER_ROLE", gov.guardian],
    [c.coll, "DEFAULT_ADMIN_ROLE", gov.timelock], [c.coll, "PAUSER_ROLE", gov.guardian],
    [c.jackpot, "DEFAULT_ADMIN_ROLE", gov.timelock],
    [c.insurance, "DEFAULT_ADMIN_ROLE", gov.timelock], [c.insurance, "CLAIMS_ROLE", gov.ops],
    [c.predictionLp, "DEFAULT_ADMIN_ROLE", gov.timelock],
    [c.predictionMarket, "DEFAULT_ADMIN_ROLE", gov.timelock], [c.predictionMarket, "OPERATOR_ROLE", gov.ops],
    [c.yieldAdapter, "DEFAULT_ADMIN_ROLE", gov.timelock], [c.yieldAdapter, "ALLOCATOR_ROLE", gov.ops],
    [c.yieldStrategy, "DEFAULT_ADMIN_ROLE", gov.timelock],
  );
  const roleOf = async (contract: any, name: string) => contract[name]();

  // 1) grant everything while the deployer is still admin
  for (const [contract, name, to] of plan) {
    const role = await roleOf(contract, name);
    if (!(await contract.hasRole(role, to))) await (await contract.grantRole(role, to)).wait();
  }
  // 2) renounce every deployer role; DEFAULT_ADMIN_ROLE last per contract
  const sorted = [...plan].sort((a, b) => Number(a[1] === "DEFAULT_ADMIN_ROLE") - Number(b[1] === "DEFAULT_ADMIN_ROLE"));
  for (const [contract, name] of sorted) {
    const role = await roleOf(contract, name);
    if (await contract.hasRole(role, me)) await (await contract.renounceRole(role, me)).wait();
  }
  // 3) deployer also holds roles that are not in the plan (e.g. receipts ISSUER is granted to vaults, not the deployer)
}
