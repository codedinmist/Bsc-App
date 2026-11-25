// Demo helper for the 3-of-5 multisig (TESTNET). Each owner key is MULTISIG_KEY_1..5 in .env.
//   node scripts/multisig.mjs status
//   node scripts/multisig.mjs propose-spend <to> <amountTINR> [ownerNo]   -> owner proposes a treasury payment (schedules it in the 48h timelock)
//   node scripts/multisig.mjs confirm <id> <ownerNo>                      -> another owner approves
//   node scripts/multisig.mjs execute <id> <ownerNo>                      -> runs it once 3 have approved
//   node scripts/multisig.mjs propose-release <to> <amountTINR> [ownerNo] -> after 48h: proposes the final payment step (also needs 3 approvals)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(fs.readFileSync(path.join(root, ".env"), "utf8").split("\n").map((l) => l.match(/^([A-Z_0-9]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const d = JSON.parse(fs.readFileSync(path.join(root, "deployments", "bscTestnet.json"), "utf8"));
const c = d.contracts;
if (!c.multisig) { console.log("This deployment has no multisig. Run npm run easy-deploy again."); process.exit(1); }
const provider = new ethers.JsonRpcProvider(env.BSC_TESTNET_RPC || "https://bsc-testnet-rpc.publicnode.com", 97, { staticNetwork: true });
const owner = (n) => { const k = env[`MULTISIG_KEY_${n}`]; if (!k) throw new Error(`No MULTISIG_KEY_${n} in .env`); return new ethers.Wallet(k, provider); };
const msAbi = ["function owners() view returns (address[])", "function threshold() view returns (uint256)", "function txCount() view returns (uint256)", "function validConfirmations(uint256) view returns (uint256)", "function getTx(uint256) view returns (tuple(address to,uint256 value,bytes data,bool executed,uint32 confirmations,uint64 createdAt))", "function submit(address,uint256,bytes) returns (uint256)", "function confirm(uint256)", "function execute(uint256) returns (bytes)"];
const tlAbi = ["function getMinDelay() view returns (uint256)", "function schedule(address,uint256,bytes,bytes32,bytes32,uint256)", "function execute(address,uint256,bytes,bytes32,bytes32)", "function isOperationReady(bytes32) view returns (bool)", "function isOperationPending(bytes32) view returns (bool)", "function hashOperation(address,uint256,bytes,bytes32,bytes32) view returns (bytes32)"];
const trAbi = ["function spend(address,uint256,bytes32)"];
const ms = new ethers.Contract(c.multisig, msAbi, provider);
const tl = new ethers.Contract(c.timelock, tlAbi, provider);
const tr = new ethers.Interface(trAbi);
const [cmd, a1, a2, a3] = process.argv.slice(2);
const salt = (to, amt) => ethers.id(`spend:${to.toLowerCase()}:${amt}`);
const spendData = (to, amt) => tr.encodeFunctionData("spend", [to, ethers.parseEther(amt), ethers.id("multisig-demo")]);
const as = (n) => new ethers.Contract(c.multisig, msAbi, owner(n));

if (cmd === "status") {
  const o = await ms.owners();
  console.log(`Multisig ${c.multisig}\nThreshold ${await ms.threshold()} of ${o.length}\nTimelock delay ${Number(await tl.getMinDelay()) / 3600} hours`);
  const seats = ["Founder", "State Governor representative", "External security auditor", "Top agent representative", "Cold backup key"];
  o.forEach((x, i) => console.log(`  Owner ${i + 1} ${seats[i] ?? ""}: ${x}`));
  const n = Number(await ms.txCount());
  for (let i = Math.max(0, n - 10); i < n; i++) { const t = await ms.getTx(i); console.log(`  Proposal ${i}: ${await ms.validConfirmations(i)}/3 approvals, ${t.executed ? "EXECUTED" : "pending"}`); }
} else if (cmd === "propose-spend") {
  const data = tl.interface.encodeFunctionData("schedule", [c.treasury, 0, spendData(a1, a2), ethers.ZeroHash, salt(a1, a2), await tl.getMinDelay()]);
  const w = as(Number(a3 ?? 1)); const tx = await w.submit(c.timelock, 0, data); await tx.wait();
  console.log(`Proposed as proposal ${Number(await ms.txCount()) - 1}. Now two more owners must approve:\n  node scripts/multisig.mjs confirm <id> 2\n  node scripts/multisig.mjs confirm <id> 3\nthen: node scripts/multisig.mjs execute <id> 1`);
} else if (cmd === "propose-release") {
  const op = await tl.hashOperation(c.treasury, 0, spendData(a1, a2), ethers.ZeroHash, salt(a1, a2));
  if (!(await tl.isOperationReady(op))) { console.log((await tl.isOperationPending(op)) ? "Still inside the 48 hour wait. Try again later." : "That payment was not scheduled."); process.exit(1); }
  const data = tl.interface.encodeFunctionData("execute", [c.treasury, 0, spendData(a1, a2), ethers.ZeroHash, salt(a1, a2)]);
  const w = as(Number(a3 ?? 1)); await (await w.submit(c.timelock, 0, data)).wait();
  console.log(`Proposed as proposal ${Number(await ms.txCount()) - 1}. Get 2 more approvals, then execute it.`);
} else if (cmd === "confirm") { await (await as(Number(a2)).confirm(a1)).wait(); console.log(`Owner ${a2} approved proposal ${a1}. Approvals: ${await ms.validConfirmations(a1)}/3`); }
else if (cmd === "execute") { await (await as(Number(a2)).execute(a1)).wait(); console.log(`Proposal ${a1} executed.`); }
else console.log("Commands: status | propose-spend <to> <amount> | confirm <id> <owner> | execute <id> <owner> | propose-release <to> <amount>");
