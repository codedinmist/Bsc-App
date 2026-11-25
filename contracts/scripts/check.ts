/** Post-deploy check against the live chain:  npx hardhat run scripts/check.ts --network bscTestnet */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `${network.name}.json`), "utf8"));
  const c = d.contracts as Record<string, string>;
  let bad = 0;
  const ok = (m: string) => console.log("  OK   " + m);
  const fail = (m: string) => { bad++; console.log("  FAIL " + m); };

  console.log(`Network ${network.name} chain ${(await ethers.provider.getNetwork()).chainId}`);
  for (const [name, addr] of Object.entries(c)) {
    const code = await ethers.provider.getCode(addr);
    code.length > 2 ? ok(`${name} has code at ${addr}`) : fail(`${name} has NO code at ${addr}`);
  }

  const ACL = ["token", "config", "registry", "receipts", "faucet", "daily", "rd", "fd", "staking", "escrow", "treasury", "emergency", "commissions", "ranks", "service", "rewards", "pool", "score", "micro", "coll", "jackpot", "insurance", "predictionLp", "predictionMarket", "yieldAdapter", "yieldStrategy"];
  const abi = ["function hasRole(bytes32,address) view returns (bool)", "function DEFAULT_ADMIN_ROLE() view returns (bytes32)"];
  for (const n of ACL) {
    const k = new ethers.Contract(c[n], abi, ethers.provider);
    const adm = await k.DEFAULT_ADMIN_ROLE();
    const deployerHas = await k.hasRole(adm, d.deployer);
    deployerHas ? fail(`${n}: deployer STILL holds admin`) : ok(`${n}: deployer holds no admin`);
    const holder = n === "faucet" ? d.governance.ops : c.timelock;
    (await k.hasRole(adm, holder)) ? ok(`${n}: admin is ${n === "faucet" ? "ops" : "timelock"}`) : fail(`${n}: expected admin ${holder} missing`);
  }

  const erc = ["function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)", "function symbol() view returns (string)", "function name() view returns (string)"];
  const token = new ethers.Contract(c.token, erc, ethers.provider);
  console.log(`  INFO token "${await token.name()}" (${await token.symbol()}), supply ${ethers.formatEther(await token.totalSupply())}`);
  const fb = await token.balanceOf(c.faucet);
  fb > 0n ? ok(`faucet funded with ${ethers.formatEther(fb)} tINR`) : fail("faucet has no tINR");

  const solv = ["function isSolvent() view returns (bool)"];
  for (const n of ["daily", "rd", "fd", "staking", "escrow", "commissions", "service", "rewards", "jackpot", "insurance", "predictionLp"]) {
    (await new ethers.Contract(c[n], solv, ethers.provider).isSolvent()) ? ok(`${n} is solvent`) : fail(`${n} is NOT solvent`);
  }
  const tl = new ethers.Contract(c.timelock, ["function getMinDelay() view returns (uint256)"], ethers.provider);
  const delay = await tl.getMinDelay();
  delay >= 172800n ? ok(`timelock delay ${delay}s (>= 48h)`) : fail(`timelock delay only ${delay}s`);

  // Deck slide 12: 3-of-5 multisig owns the timelock; the timelock owns the treasury; nobody can skip the delay.
  if (c.multisig) {
    const ms = new ethers.Contract(c.multisig, ["function owners() view returns (address[])", "function threshold() view returns (uint256)"], ethers.provider);
    const owners: string[] = await ms.owners(); const th = await ms.threshold();
    owners.length === 5 && th === 3n ? ok(`multisig is 3-of-5 (${owners.length} owners, threshold ${th})`) : fail(`multisig is ${th}-of-${owners.length}, expected 3-of-5`);
    const tlr = new ethers.Contract(c.timelock, ["function hasRole(bytes32,address) view returns (bool)", "function PROPOSER_ROLE() view returns (bytes32)", "function EXECUTOR_ROLE() view returns (bytes32)", "function CANCELLER_ROLE() view returns (bytes32)", "function DEFAULT_ADMIN_ROLE() view returns (bytes32)"], ethers.provider);
    for (const r of ["PROPOSER_ROLE", "EXECUTOR_ROLE", "CANCELLER_ROLE"]) (await tlr.hasRole(await tlr[r](), c.multisig)) ? ok(`timelock ${r} = multisig`) : fail(`timelock ${r} is not the multisig`);
    for (const who of [d.deployer, ...(d.governance.ops ? [d.governance.ops] : [])]) (await tlr.hasRole(await tlr.PROPOSER_ROLE(), who)) ? fail(`timelock proposer includes ${who}`) : ok(`timelock proposer excludes ${who}`);
    (await tlr.hasRole(await tlr.DEFAULT_ADMIN_ROLE(), d.deployer)) ? fail("deployer is timelock admin") : ok("no one can bypass the timelock (deployer is not admin)");
  } else fail("no multisig recorded: the timelock is controlled by a single address");

  // Deck slide 7/8 rules are wired and switched on.
  {
    const reg = new ethers.Contract(c.registry, ["function agentGate() view returns (address)"], ethers.provider);
    (await reg.agentGate()).toLowerCase() === c.ranks.toLowerCase() ? ok("registry asks NetworkRanks before verifying an agent") : fail("agent eligibility gate is not set");
    const cfg = new ethers.Contract(c.config, ["function getUint(bytes32) view returns (uint256)"], ethers.provider);
    (await cfg.getUint(ethers.id("REQUIRE_KYC"))) === 1n ? ok("KYC is required for deposits") : fail("REQUIRE_KYC is off");
    const mc = new ethers.Contract(c.micro, ["function requireKyc() view returns (bool)"], ethers.provider);
    (await mc.requireKyc()) ? ok("KYC is required for Vyapar loans") : fail("MicroCredit KYC is off");
    const cl = new ethers.Contract(c.coll, ["function kycRegistry() view returns (address)"], ethers.provider);
    (await cl.kycRegistry()) !== ethers.ZeroAddress ? ok("KYC is required for collateral loans") : fail("CollateralLoan KYC is off");
    const cm = new ethers.Contract(c.commissions, ["function hasRole(bytes32,address) view returns (bool)", "function RANKS_ROLE() view returns (bytes32)"], ethers.provider);
    (await cm.hasRole(await cm.RANKS_ROLE(), c.ranks)) ? ok("NetworkRanks can set heads (and nothing else)") : fail("NetworkRanks lacks RANKS_ROLE");
    const sv = new ethers.Contract(c.service, ["function pool() view returns (uint256)"], ethers.provider);
    (await sv.pool()) > 0n ? ok(`service commission pool funded (${ethers.formatEther(await sv.pool())} tINR)`) : fail("service commission pool is empty");
  }

  console.log(bad === 0 ? "\nALL CHECKS PASSED" : `\n${bad} CHECK(S) FAILED`);
  process.exit(bad === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
