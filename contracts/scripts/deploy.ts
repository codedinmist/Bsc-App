/**
 * JanSetu testnet deployment (phases 1-2).
 *   npx hardhat run scripts/deploy.ts --network bscTestnet
 * Needs in .env: DEPLOYER_PRIVATE_KEY, SAFE_ADDRESS (3-of-5 multisig), OPS_ADDRESS, GUARDIAN_ADDRESS.
 * The deployer keeps NO privileged role afterwards.
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { deployCore, handOverGovernance, E } from "./lib/deployAll";

const need = (n: string) => {
  const v = process.env[n];
  if (!v || !ethers.isAddress(v)) throw new Error(`Set ${n} in .env to a valid address`);
  return v;
};

async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  if (!deployer) throw new Error("No deployer. Set DEPLOYER_PRIVATE_KEY in .env");
  const isLocal = network.name === "hardhat" || network.name === "localhost";
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (!isLocal && chainId !== 97) throw new Error(`Refusing to deploy: expected BNB Testnet (97), got ${chainId}`);

  const ops = isLocal ? signers[2].address : need("OPS_ADDRESS");
  const guardian = isLocal ? signers[3].address : need("GUARDIAN_ADDRESS");
  const delay = Number(process.env.TIMELOCK_DELAY ?? 172800); // 48h
  if (!isLocal && delay < 172800) throw new Error("TIMELOCK_DELAY below 48h is not allowed on testnet release");

  console.log(`Deployer ${deployer.address} on chain ${chainId}`);
  // The free public RPC can answer with a stale nonce, so track nonces locally.
  const managed = new ethers.NonceManager(deployer);

  // Deck slide 12: a 3-of-5 multisig owns the 48h timelock. Owners come from MULTISIG_OWNERS (5 addresses).
  // Or set SAFE_ADDRESS to an existing Safe (recommended for mainnet; see docs/MULTISIG.md).
  const msOwners = (process.env.MULTISIG_OWNERS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const msThreshold = Number(process.env.MULTISIG_THRESHOLD ?? 3);
  const owners = msOwners.length ? msOwners : (isLocal ? [5, 6, 7, 8, 9].map((i) => signers[i].address) : []);
  let multisig: any;
  let safe = process.env.SAFE_ADDRESS ?? "";
  if (owners.length) {
    if (owners.length !== 5 || msThreshold !== 3) throw new Error("Deck requires exactly 5 owners and a threshold of 3");
    if (new Set(owners.map((o) => o.toLowerCase())).size !== 5) throw new Error("MULTISIG_OWNERS has a duplicate address");
    multisig = await ethers.deployContract("JanSetuMultiSig", [owners, msThreshold], managed);
    await multisig.waitForDeployment();
    safe = await multisig.getAddress();
    console.log(`Multisig 3-of-5 at ${safe}`);
  }
  if (!safe) throw new Error("Set MULTISIG_OWNERS (5 addresses) or SAFE_ADDRESS in .env");
  const c = await deployCore({ admin: managed, initialHolder: deployer.address, deckRewardTargets: true, slashSink: safe, guardian, requireKyc: true, enforceAgentRules: true, ranksProfile: process.env.RANKS_PROFILE === "demo" ? "demo" : "deck" });

  const timelock = await ethers.deployContract("JanSetuTimelock", [delay, [safe], [safe]], managed);
  await timelock.waitForDeployment();
  c.args["JanSetuTimelock"] = [delay, [safe], [safe]];
  if (multisig) c.args["JanSetuMultiSig"] = [owners, msThreshold];

  // Seed the faucet and the funded reward pools (real tokens moved, nothing is created out of thin air).
  const faucetFund = E(process.env.FAUCET_FUND ?? "5000000");
  const rewardFund = E(process.env.REWARD_FUND_PER_VAULT ?? "2000000");
  await (await c.token.transfer(await c.faucet.getAddress(), faucetFund)).wait();
  for (const v of [c.daily, c.rd, c.fd]) {
    await (await c.token.approve(await v.getAddress(), rewardFund)).wait();
    await (await v.fundRewards(rewardFund)).wait();
  }

  // Fund the pools (real test tokens moved; every pool pays out only what it holds).
  const give = async (to: any, amt: string, spender?: any) => {
    const a = E(amt);
    if (spender) { await (await c.token.approve(await spender.getAddress(), a)).wait(); await (await spender.fund(a)).wait(); }
    else await (await c.token.transfer(await to.getAddress(), a)).wait();
  };
  await give(null, process.env.COMMISSION_FUND ?? "1000000", c.commissions);
  await give(null, process.env.SERVICE_FUND ?? "300000", c.service);
  await give(null, process.env.REWARDS_FUND ?? "500000", c.rewards);
  await give(null, process.env.JACKPOT_FUND ?? "300000", c.jackpot);
  await give(null, process.env.INSURANCE_FUND ?? "300000", c.insurance);
  await (await c.token.approve(await c.pool.getAddress(), E(process.env.LOAN_POOL_FUND ?? "1000000"))).wait();
  await (await c.pool.deposit(E(process.env.LOAN_POOL_FUND ?? "1000000"))).wait();
  await give(c.treasury, process.env.TREASURY_FUND ?? "500000");
  await (await c.token.approve(await c.yieldStrategy.getAddress(), E("50000"))).wait();
  await (await c.yieldStrategy.fundReserve(E("50000"))).wait();

  await handOverGovernance(c, managed, { timelock: await timelock.getAddress(), ops, guardian });

  const out: any = {
    network: network.name, chainId, deployedAt: new Date().toISOString(),
    block: await ethers.provider.getBlockNumber(), deployer: deployer.address,
    governance: { safe, multisigOwners: owners, multisigThreshold: owners.length ? msThreshold : undefined, timelock: await timelock.getAddress(), ops, guardian, timelockDelaySeconds: delay },
    contracts: {} as Record<string, string>, constructorArgs: {} as Record<string, any[]>,
  };
  for (const [name, contract] of Object.entries(c)) if (name !== "args") out.contracts[name] = await (contract as any).getAddress();
  out.contracts.timelock = await timelock.getAddress();
  if (multisig) out.contracts.multisig = safe;
  out.constructorArgs = JSON.parse(JSON.stringify(c.args, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out.contracts, null, 2));
  console.log(`Saved deployments/${network.name}.json. Next: npx hardhat run scripts/verify.ts --network ${network.name}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
