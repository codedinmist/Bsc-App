// One-command TESTNET deploy.  Run:  npm run easy-deploy
// - creates two brand-new throwaway wallets (deployer + admin) and saves them in .env / wallets.txt
// - waits until you send test BNB to the deployer, then deploys everything and links the app
// TESTNET ONLY. Governance is a real 3-of-5 multisig (deck slide 12) plus the 48h timelock.
// The five owner keys are created here for the demo. For real use each owner holds their OWN key (docs/MULTISIG.md).
// ONE admin wallet still plays the day-to-day ops and guardian roles on testnet.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const envPath = path.join(root, ".env");
const RPCS = ["https://bsc-testnet-rpc.publicnode.com", "https://data-seed-prebsc-1-s1.bnbchain.org:8545", "https://data-seed-prebsc-2-s1.bnbchain.org:8545"];
const MIN = ethers.parseEther("0.05");

function readEnv() {
  const o = {};
  if (fs.existsSync(envPath)) for (const l of fs.readFileSync(envPath, "utf8").split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) o[m[1]] = m[2]; }
  return o;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function provider() {
  for (const url of RPCS) {
    try { const p = new ethers.JsonRpcProvider(url, 97, { staticNetwork: true }); const id = await Promise.race([p.send("eth_chainId", []), sleep(8000).then(() => { throw new Error("timeout"); })]); if (Number(id) === 97) return [p, url]; } catch {}
  }
  throw new Error("Could not reach BNB Testnet. Check your internet and try again.");
}

const env = readEnv();
env.BSC_TESTNET_RPC = RPCS[0];
if (!env.DEPLOYER_PRIVATE_KEY || !env.ADMIN_PRIVATE_KEY) {
  const d = ethers.Wallet.createRandom(), a = ethers.Wallet.createRandom();
  env.DEPLOYER_PRIVATE_KEY = d.privateKey; env.ADMIN_PRIVATE_KEY = a.privateKey;
  env.SAFE_ADDRESS = env.OPS_ADDRESS = env.GUARDIAN_ADDRESS = a.address;
  env.BSC_TESTNET_RPC = RPCS[0]; env.TIMELOCK_DELAY = "172800";
  fs.writeFileSync(envPath, Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
  fs.writeFileSync(path.join(root, "wallets.txt"),
    `TESTNET wallets created ${new Date().toISOString()}\nDEPLOYER ${d.address}\nADMIN    ${a.address}\nKeys are in .env. Never put real money in these wallets. Never share this folder.\n`, { mode: 0o600 });
  console.log("\nCreated two new test wallets (saved in .env).");
}
const SEATS = ["Founder", "State Governor representative", "External security auditor", "Top agent representative", "Cold backup key"];
if (!env.MULTISIG_OWNERS) {
  const ws = SEATS.map(() => ethers.Wallet.createRandom());
  env.MULTISIG_OWNERS = ws.map((w) => w.address).join(","); env.MULTISIG_THRESHOLD = "3";
  ws.forEach((w, i) => { env[`MULTISIG_KEY_${i + 1}`] = w.privateKey; });
  fs.writeFileSync(envPath, Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
  fs.appendFileSync(path.join(root, "wallets.txt"), `\nMULTISIG 3-of-5 owners (TESTNET demo keys, in .env as MULTISIG_KEY_1..5):\n` + ws.map((w, i) => `  ${i + 1}. ${SEATS[i]}: ${w.address}`).join("\n") + "\n");
  console.log("\nCreated 5 multisig owner wallets (3 must approve every treasury or governance change).");
}
const deployer = new ethers.Wallet(env.DEPLOYER_PRIVATE_KEY);
let prov, rpc;
try { [prov, rpc] = await provider(); } catch (e) { console.error("\n" + e.message); process.exit(1); }
console.log(`\nConnected to BNB Testnet.\n\n>>> Send free test BNB to this address:\n\n    ${deployer.address}\n`);
console.log("Get it free at https://www.bnbchain.org/en/testnet-faucet (paste the address above).");
console.log(`Waiting for at least 0.05 test BNB... (Ctrl+C to stop; run this command again any time)\n`);
for (;;) {
  let bal = 0n;
  try { bal = await prov.getBalance(deployer.address); } catch { process.stdout.write("  (network slow, retrying...)      \r"); await sleep(5000); continue; }
  if (bal >= MIN) { console.log(`Received ${ethers.formatEther(bal)} test BNB. Deploying...\n`); break; }
  process.stdout.write(`  balance ${ethers.formatEther(bal)} BNB\r`);
  await sleep(5000);
}

const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env, BSC_TESTNET_RPC: rpc } });
  if (r.status !== 0) { console.error(`\nFailed: ${cmd} ${args.join(" ")}`); process.exit(r.status ?? 1); }
};
run("npx", ["hardhat", "run", "scripts/deploy.ts", "--network", "bscTestnet"], root);
run("node", ["scripts/sync-contracts.mjs"], path.join(root, "..", "apps", "mobile"));
console.log("\nDONE. Contracts are deployed on BNB Testnet and linked into the app.\nNext: build the APK (see apps/mobile: npm run build:apk).");
