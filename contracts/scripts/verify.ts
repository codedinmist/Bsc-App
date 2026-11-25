/** Verifies every deployed contract on BscScan (needs BSCSCAN_API_KEY). */
import { run, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const NAMES: Record<string, string> = {
  forwarder: "JanSetuForwarder", token: "INRToken", config: "ProtocolConfig", registry: "JanSetuRegistry",
  receipts: "DigitalReceiptNFT", faucet: "JanSetuFaucet", daily: "DailyVault", rd: "RecurringDepositVault",
  fd: "FixedDepositVault", timelock: "JanSetuTimelock", multisig: "JanSetuMultiSig",
};
async function main() {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `${network.name}.json`), "utf8"));
  for (const [key, name] of Object.entries(NAMES)) {
    const address = d.contracts[key];
    if (!address) continue;
    try {
      await run("verify:verify", { address, constructorArguments: d.constructorArgs[name] ?? [] });
      console.log("verified", name, address);
    } catch (e: any) {
      console.log(/already verified/i.test(String(e.message)) ? `already verified ${name}` : `FAILED ${name}: ${e.message}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
