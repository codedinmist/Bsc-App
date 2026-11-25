// Operator desk for the TESTNET demo. Uses the ADMIN wallet from .env (it holds the operator role on testnet).
//   node scripts/ops.mjs kyc <address>           approve identity check (KYC) for one wallet
//   node scripts/ops.mjs kyc-all                 approve everyone who joined and is not verified yet
//   node scripts/ops.mjs agent-status <address>  what an agent still needs (KYC, stake, own savings, referrals)
//   node scripts/ops.mjs make-agent <address> [cluster district state]   make a wallet an agent (default area 1 1 1) and verify it if it qualifies
//   node scripts/ops.mjs keeper [--loop]         count commissions, update ranks, pay P2P/loan/prediction commissions (anyone can run it)
//   node scripts/ops.mjs give <address> <amount>   send test tINR from the deployer wallet
//   node scripts/ops.mjs demo-agent              create a ready-made agent + 2 customers and print the agent's 12 words
//   node scripts/ops.mjs ranks                   show ranks and progress for every agent
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readEnv = () => { try { return fs.readFileSync(path.join(root, ".env"), "utf8"); } catch { return ""; } };
const env = Object.fromEntries(readEnv().split("\n").map((l) => l.match(/^([A-Z_0-9]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const d = JSON.parse(fs.readFileSync(path.join(root, "deployments", `${process.env.DEPLOY_NAME || "bscTestnet"}.json`), "utf8"));
const c = d.contracts;
const rpc = process.env.BSC_TESTNET_RPC || env.BSC_TESTNET_RPC || "https://bsc-testnet-rpc.publicnode.com";
const provider = new ethers.JsonRpcProvider(rpc, Number(process.env.CHAIN_ID || 97), { staticNetwork: true });
const key = process.env.ADMIN_PRIVATE_KEY || env.ADMIN_PRIVATE_KEY;
if (!key) { console.error("No ADMIN_PRIVATE_KEY in .env"); process.exit(1); }
const admin = new ethers.NonceManager(new ethers.Wallet(key, provider));
const E = (x) => ethers.formatEther(x);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pos = "tuple(address owner,uint128 principal,uint128 locked,uint128 rewardReserved,uint128 rewardUnfunded,uint64 openedAt,uint64 maturityAt,bool collateralEligible,uint8 status)";
const registry = new ethers.Contract(c.registry, [
  "event Registered(address indexed account)", "function isKyc(address) view returns (bool)", "function isRegistered(address) view returns (bool)", "function isActiveAgent(address) view returns (bool)",
  "function setKyc(address,bool)", "function assignAgent(address,uint32,uint32,uint32)", "function setAgentVerified(address,bool)", "function roleOf(address) view returns (uint8)",
  "function profileOf(address) view returns (tuple(uint8 role,bool kycVerified,bool agentVerified,bool suspended,uint32 clusterId,uint32 districtId,uint32 stateId,uint64 registeredAt))",
], admin);
const ranks = new ethers.Contract(c.ranks, [
  "function isAgentEligible(address) view returns (bool)", "function ownInvestment(address) view returns (uint256)", "function kycReferrals(address) view returns (uint256)",
  "function ownInvestmentMin() view returns (uint256)", "function referralsMin() view returns (uint16)", "function rankOf(address) view returns (uint8)",
  "function syncAgent(address)", "function tracked(address) view returns (bool)", "function seenVolume(address) view returns (uint256)",
  "function promoteCluster(uint32)", "function promoteDistrict(uint32)", "function promoteState(uint32)",
  "function clusterHead(uint32) view returns (address)", "function districtHead(uint32) view returns (address)", "function stateHead(uint32) view returns (address)",
  "function clusterAgents(uint32) view returns (uint16)", "function clusterVolume(uint32) view returns (uint256)", "function districtVolume(uint32) view returns (uint256)", "function stateVolume(uint32) view returns (uint256)",
  "function clustersInDistrict(uint32) view returns (uint16)", "function districtsInState(uint32) view returns (uint16)", "function clusterDistrict(uint32) view returns (uint32)", "function districtState(uint32) view returns (uint32)",
  "function clusterAgentsMin() view returns (uint16)", "function clusterVolumeMin() view returns (uint256)", "function districtClustersMin() view returns (uint16)", "function districtVolumeMin() view returns (uint256)", "function stateDistrictsMin() view returns (uint16)", "function stateVolumeMin() view returns (uint256)",
], admin);
const staking = new ethers.Contract(c.staking, ["function accounts(address) view returns (uint256 staked,uint256 reserved,uint256 pending,uint64 unlockAt)", "function minStake() view returns (uint256)"], provider);
const comm = new ethers.Contract(c.commissions, [
  "event ReferrerSet(address indexed customer, address indexed agent)", "function sync(address,uint256)", "function referrerOf(address) view returns (address)", "function agentVolume(address) view returns (uint256)",
  "function scheduleOf(address,uint256) view returns (address[5],uint128[5],uint128,uint64,uint64,bool)", "function pool() view returns (uint256)",
], admin);
const vaultAbi = ["function nextPositionId() view returns (uint256)", `function getPosition(uint256) view returns (${pos})`];
const vaults = ["daily", "rd", "fd"].map((k) => new ethers.Contract(c[k], vaultAbi, provider));
const service = new ethers.Contract(c.service, [
  "function syncP2P(uint256)", "function syncLoan(uint256)", "function sweepPrediction()", "function payDistrict(uint32)", "function districtPending(uint32) view returns (uint256)",
  "function p2pPaid(uint256) view returns (bool)", "function loanOpenPaid(uint256) view returns (bool)", "function recoveryBasis(uint256) view returns (uint256)", "function pool() view returns (uint256)", "function districtOwed() view returns (uint256)",
], admin);
const escrow = new ethers.Contract(c.escrow, ["function nextOrderId() view returns (uint256)", "function orders(uint256) view returns (address,address,uint128,uint64,uint64,uint8,uint8)"], provider);
const micro = new ethers.Contract(c.micro, ["function nextLoanId() view returns (uint256)", "function getLoan(uint256) view returns (tuple(address borrower,address verifier,uint128 principal,uint128 totalDue,uint128 installment,uint128 paid,uint128 principalRepaid,uint32 count,uint32 paidCount,uint64 nextDue,uint8 tier,bool reliefUsed,uint8 status))"], provider);
const token = new ethers.Contract(c.token, ["function balanceOf(address) view returns (uint256)"], provider);

async function send(label, p) {
  try { const tx = await p; await tx.wait(); console.log("  ok  ", label); return true; }
  catch (e) { console.log("  skip", label, "-", (e.shortMessage || e.reason || e.message || "").slice(0, 110)); return false; }
}

async function giveTokens(to, amount) {
  const dk = process.env.DEPLOYER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
  if (!dk) { console.log("No DEPLOYER_PRIVATE_KEY in .env"); process.exit(1); }
  const dep = new ethers.NonceManager(new ethers.Wallet(dk, provider));
  await send(`send ${amount} tINR to ${to}`, new ethers.Contract(c.token, ["function transfer(address,uint256) returns (bool)"], dep).transfer(to, ethers.parseEther(String(amount))));
}

async function joined() {
  const logs = await registry.queryFilter(registry.filters.Registered(), Math.max(0, (d.block ?? 0) - 1));
  return [...new Set(logs.map((l) => l.args.account))];
}

async function agentStatus(a) {
  const p = await registry.profileOf(a);
  const [st, minStake, own, ownMin, refs, refsMin] = await Promise.all([staking.accounts(a), staking.minStake(), ranks.ownInvestment(a), ranks.ownInvestmentMin(), ranks.kycReferrals(a), ranks.referralsMin()]);
  const yn = (b) => (b ? "YES" : "no ");
  console.log(`Agent ${a}\n  role: ${["none", "customer", "agent"][Number(p.role)] ?? p.role}   verified: ${yn(p.agentVerified)}   area: cluster ${p.clusterId} / district ${p.districtId} / state ${p.stateId}`);
  console.log(`  ${yn(p.kycVerified)} KYC done`);
  console.log(`  ${yn(st.staked >= minStake)} stake ${E(st.staked)} of ${E(minStake)} tINR`);
  console.log(`  ${yn(own >= ownMin)} own savings ${E(own)} of ${E(ownMin)} tINR`);
  console.log(`  ${yn(refs >= refsMin)} KYC'd customers who chose this agent: ${refs} of ${refsMin}`);
  const ok = await ranks.isAgentEligible(a);
  console.log(`  => ${ok ? "ELIGIBLE: can be verified" : "not eligible yet"}`);
  return { ok, p };
}

async function keeper() {
  let did = 0;
  // 1) deposits -> commission (customers who chose an agent)
  for (const [i, v] of vaults.entries()) {
    const next = Number(await v.nextPositionId());
    for (let id = 1; id < next; id++) {
      const p = await v.getPosition(id);
      if (Number(p.status) !== 1) continue;
      const ref = await comm.referrerOf(p.owner);
      if (ref === ethers.ZeroAddress) continue;
      const sch = await comm.scheduleOf(await v.getAddress(), id);
      if (sch[2] >= p.principal) continue; // nothing new
      if (await send(`count commission ${["daily", "rd", "fd"][i]} #${id}`, comm.sync(await v.getAddress(), id))) did++;
    }
  }
  // 2) agents -> ranks (volume), then promotions that are ready
  const agents = [];
  for (const a of await joined()) if (await registry.isActiveAgent(a)) agents.push(a);
  for (const a of agents) if (!(await ranks.tracked(a)) || (await comm.agentVolume(a)) > (await ranks.seenVolume(a))) { if (await send(`update rank volume ${a.slice(0, 8)}`, ranks.syncAgent(a))) did++; }
  const areas = new Map();
  for (const a of agents) { const p = await registry.profileOf(a); areas.set(`${p.clusterId}`, p); }
  for (const p of areas.values()) {
    const cl = p.clusterId, di = p.districtId, stt = p.stateId;
    if ((await ranks.clusterHead(cl)) === ethers.ZeroAddress && (await ranks.clusterAgents(cl)) >= (await ranks.clusterAgentsMin()) && (await ranks.clusterVolume(cl)) >= (await ranks.clusterVolumeMin())) { if (await send(`promote cluster ${cl}`, ranks.promoteCluster(cl))) did++; }
    if ((await ranks.districtHead(di)) === ethers.ZeroAddress && (await ranks.clustersInDistrict(di)) >= (await ranks.districtClustersMin()) && (await ranks.districtVolume(di)) >= (await ranks.districtVolumeMin())) { if (await send(`promote district ${di}`, ranks.promoteDistrict(di))) did++; }
    if ((await ranks.stateHead(stt)) === ethers.ZeroAddress && (await ranks.districtsInState(stt)) >= (await ranks.stateDistrictsMin()) && (await ranks.stateVolume(stt)) >= (await ranks.stateVolumeMin())) { if (await send(`promote state ${stt}`, ranks.promoteState(stt))) did++; }
  }
  // 3) P2P orders and loans -> service commissions
  const no = Number(await escrow.nextOrderId());
  for (let id = 1; id < no; id++) {
    const o = await escrow.orders(id);
    if ((Number(o[6]) === 2 || Number(o[6]) === 6) && !(await service.p2pPaid(id)) && (await send(`pay P2P commission order #${id}`, service.syncP2P(id)))) did++;
  }
  const nl = Number(await micro.nextLoanId());
  for (let id = 1; id < nl; id++) {
    const l = await micro.getLoan(id);
    if (l.verifier === ethers.ZeroAddress || Number(l.status) === 0) continue;
    const open = !(await service.loanOpenPaid(id)); const rec = l.paid > (await service.recoveryBasis(id));
    if ((open || rec) && (await send(`pay loan commission #${id}`, service.syncLoan(id)))) did++;
  }
  // 4) prediction fees -> districts and DAO
  const fresh = (await token.balanceOf(c.service)) - (await service.pool()) - (await service.districtOwed());
  if (fresh > 0n && (await send("split prediction fees", service.sweepPrediction()))) did++;
  for (const di of new Set([...areas.values()].map((p) => Number(p.districtId)))) if ((await service.districtPending(di)) > 0n && (await send(`pay district ${di} prediction share`, service.payDistrict(di)))) did++;
  console.log(did ? `Done: ${did} action(s).` : "Nothing to do.");
}

const [cmd, a1, a2, a3, a4] = process.argv.slice(2);
if (cmd === "kyc") {
  await send(`KYC for ${a1}`, registry.setKyc(a1, true));
} else if (cmd === "kyc-all") {
  let n = 0;
  for (const a of await joined()) if (!(await registry.isKyc(a))) { if (await send(`KYC for ${a}`, registry.setKyc(a, true))) n++; }
  console.log(n ? `Verified ${n} wallet(s).` : "Everyone who joined is already verified.");
} else if (cmd === "agent-status") {
  await agentStatus(a1);
} else if (cmd === "make-agent") {
  if (!(await registry.isRegistered(a1))) { console.log("That wallet has not joined JanSetu yet. Open the app on that phone, tap Join JanSetu, then try again."); process.exit(1); }
  await send("KYC", registry.setKyc(a1, true));
  const p = await registry.profileOf(a1);
  if (Number(p.role) !== 2) await send("make agent", registry.assignAgent(a1, Number(a2 ?? 1), Number(a3 ?? 1), Number(a4 ?? 1)));
  const { ok } = await agentStatus(a1);
  if (ok) await send("verify agent", registry.setAgentVerified(a1, true));
  else console.log("\nNot verified yet. The agent must finish the missing items above (in the app: Agent tools -> stake; Fixed deposit for own savings; two KYC'd customers choose this agent in Pay -> Choose agent). Then run this command again.");
} else if (cmd === "give") {
  // node scripts/ops.mjs give <address> <amount>   send test tINR from the deployer wallet (the faucet only gives 1,000 a day)
  await giveTokens(a1, a2 ?? "1000");
} else if (cmd === "demo-agent") {
  // Creates one agent and two customers on the server, does every step, and prints the agent's 12 words for the app.
  const area = [Number(a1 ?? 1), Number(a2 ?? 1), Number(a3 ?? 1)];
  const agentW = ethers.Wallet.createRandom();
  const custW = [ethers.Wallet.createRandom(), ethers.Wallet.createRandom()];
  const S = [agentW, ...custW].map((w) => new ethers.NonceManager(w.connect(provider)));
  console.log("1/6 gas for the demo wallets (a few cents of test BNB, from the admin wallet)");
  for (const [i, w] of [agentW, ...custW].entries()) await send(`gas for wallet ${i + 1}`, admin.sendTransaction({ to: w.address, value: ethers.parseEther(i === 0 ? "0.004" : "0.002") }));
  console.log("2/6 join JanSetu");
  const R = new ethers.Contract(c.registry, ["function register()"]);
  for (const s of S) await send("join", R.connect(s).register());
  console.log("3/6 KYC and agent role");
  for (const w of [agentW, ...custW]) await send(`KYC ${w.address.slice(0, 8)}`, registry.setKyc(w.address, true));
  await send("agent role", registry.assignAgent(agentW.address, ...area));
  const [minStake, ownMin] = await Promise.all([staking.minStake(), ranks.ownInvestmentMin()]);
  console.log(`4/6 test tINR for the agent (${E(minStake + ownMin + 1000n * 10n ** 18n)})`);
  await giveTokens(agentW.address, E(minStake + ownMin + 1000n * 10n ** 18n));
  console.log("5/6 agent stakes and opens a fixed deposit");
  const T = new ethers.Contract(c.token, ["function approve(address,uint256) returns (bool)"], S[0]);
  await send("allow staking", T.approve(c.staking, ethers.MaxUint256));
  await send("stake", new ethers.Contract(c.staking, ["function stake(uint256)"], S[0]).stake(minStake));
  await send("allow deposit", T.approve(c.fd, ethers.MaxUint256));
  await send("fixed deposit", new ethers.Contract(c.fd, ["function open(uint256,uint256,bool) returns (uint256)"], S[0]).open(1, ownMin, false));
  console.log("6/6 two customers choose the agent");
  for (const s of S.slice(1)) await send("choose agent", new ethers.Contract(c.commissions, ["function setReferrer(address)"], s).setReferrer(agentW.address));
  const { ok } = await agentStatus(agentW.address);
  if (ok) await send("verify agent", registry.setAgentVerified(agentW.address, true));
  console.log(`\nAGENT ADDRESS: ${agentW.address}\nAGENT 12 WORDS (type these in the app: I already have a recovery phrase):\n${agentW.mnemonic.phrase}\n\nCustomer wallets: ${custW.map((w) => w.address).join("  ")}`);
} else if (cmd === "keeper") {
  if (process.argv.includes("--loop")) { for (;;) { try { await keeper(); } catch (e) { console.log("keeper error:", e.shortMessage || e.message); } await sleep(60_000); } }
  else await keeper();
} else if (cmd === "ranks") {
  for (const a of await joined()) if (await registry.isActiveAgent(a)) { const p = await registry.profileOf(a); console.log(`${a}  rank ${["none", "agent", "cluster head", "district head", "state head"][Number(await ranks.rankOf(a))]}  area ${p.clusterId}/${p.districtId}/${p.stateId}`); }
  console.log(`cluster 1: ${await ranks.clusterAgents(1)} agents (need ${await ranks.clusterAgentsMin()}), volume ${E(await ranks.clusterVolume(1))} (need ${E(await ranks.clusterVolumeMin())})`);
} else {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 8).join("\n"));
}
