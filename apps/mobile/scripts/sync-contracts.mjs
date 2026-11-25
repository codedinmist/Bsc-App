// Copies deployed addresses from contracts/deployments/bscTestnet.json into the app. Run after you deploy.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "..", "..", "contracts", "deployments", "bscTestnet.json");
const dst = path.join(here, "..", "src", "chain", "deployments.json");
if (!fs.existsSync(src)) { console.error(`Not found: ${src}\nDeploy first (contracts: npm run deploy:testnet).`); process.exit(1); }
const d = JSON.parse(fs.readFileSync(src, "utf8"));
if (d.chainId !== 97) { console.error(`Refusing: deployment is for chain ${d.chainId}, expected 97 (BNB Testnet).`); process.exit(1); }
const keys = ["token", "faucet", "registry", "daily", "rd", "fd", "receipts", "config", "forwarder", "timelock", "staking", "escrow", "treasury", "emergency", "commissions", "rewards", "pool", "score", "micro", "coll", "jackpot", "insurance", "predictionLp", "predictionMarket", "yieldAdapter", "yieldStrategy", "ranks", "service", "multisig"];
const contracts = {};
for (const k of keys) {
  const a = d.contracts?.[k];
  if (!/^0x[0-9a-fA-F]{40}$/.test(a ?? "")) { console.error(`Missing or invalid address for "${k}"`); process.exit(1); }
  contracts[k] = a;
}
fs.writeFileSync(dst, JSON.stringify({ network: "bscTestnet", chainId: 97, contracts }, null, 2) + "\n");
console.log("Linked contracts:\n" + Object.entries(contracts).map(([k, v]) => `  ${k}: ${v}`).join("\n"));
