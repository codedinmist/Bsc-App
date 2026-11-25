/** Writes ABIs for the app/backend to ../packages/abi. Run after `npx hardhat compile`. */
import * as fs from "fs";
import * as path from "path";
const NAMES = ["INRToken","JanSetuForwarder","JanSetuFaucet","ProtocolConfig","JanSetuRegistry","DigitalReceiptNFT","DailyVault","RecurringDepositVault","FixedDepositVault","JanSetuTimelock","JanSetuMultiSig","AgentStaking","P2PEscrow","Treasury","EmergencyController","CommissionManager","NetworkRanks","ServiceCommission","RewardsManager","LoanLiquidityPool","CreditScoreNFT","MicroCredit","CollateralLoan","SundayJackpot","InsurancePool","PredictionLP","MockPredictionMarket","YieldStrategyAdapter","MockStrategy"];
const out = path.join(__dirname, "..", "..", "packages", "abi");
fs.mkdirSync(path.join(out, "abis"), { recursive: true });
let index = "";
for (const n of NAMES) {
  const file = ({ MockPredictionMarket: "PredictionLP", MockStrategy: "YieldStrategyAdapter" } as Record<string, string>)[n] ?? n;
  const f = (p: string) => path.join(__dirname, "..", "artifacts", "contracts", p, `${file}.sol`, `${n}.json`);
  const hit = ["core", "vaults", "rewards", "credit", "insurance"].map(f).find(fs.existsSync);
  if (!hit) throw new Error(`artifact for ${n} not found`);
  const abi = JSON.parse(fs.readFileSync(hit, "utf8")).abi;
  fs.writeFileSync(path.join(out, "abis", `${n}.json`), JSON.stringify(abi, null, 2));
  index += `export { default as ${n}Abi } from "./abis/${n}.json";\n`;
}
fs.writeFileSync(path.join(out, "index.ts"), index);
fs.writeFileSync(path.join(out, "package.json"), JSON.stringify({ name: "@jansetu/abi", version: "0.1.0", main: "index.ts", types: "index.ts" }, null, 2));
console.log("ABIs exported to packages/abi");
