import fs from "node:fs";
import path from "node:path";
import { toFunctionSelector, toEventSelector, type Abi, type AbiFunction } from "viem";
import { collAbi, commissionsAbi, dailyAbi, erc20Abi, escrowAbi, faucetAbi, fdAbi, insuranceAbi, jackpotAbi, microAbi, poolAbi, rdAbi, registryAbi, rewardsAbi, scoreAbi, stakingAbi, vaultPledgeAbi, ranksAbi, serviceAbi, multisigAbi, timelockAbi } from "../src/chain/abis";

const dir = path.join(__dirname, "..", "..", "..", "packages", "abi", "abis");
const load = (n: string) => JSON.parse(fs.readFileSync(path.join(dir, `${n}.json`), "utf8")) as Abi;

const sig = (i: { name?: string; inputs?: readonly { type: string }[] }) => `${i.name}(${(i.inputs ?? []).map((x) => x.type).join(",")})`;

/** Every function/error the app declares must exist in the real compiled contract with identical types. */
function conforms(appAbi: Abi, real: Abi) {
  const realFns = new Map(real.filter((x) => x.type === "function").map((x) => [sig(x as AbiFunction), x as AbiFunction]));
  const realErrs = new Set(real.filter((x) => x.type === "error").map((x) => sig(x as unknown as AbiFunction)));
  const problems: string[] = [];
  for (const item of appAbi) {
    if (item.type === "function") {
      const r = realFns.get(sig(item));
      if (!r) { problems.push(`missing function ${sig(item)}`); continue; }
      const out = (x: AbiFunction) => (x.outputs ?? []).map((o) => o.type === "tuple" ? "tuple" : o.type).join(",");
      if (out(r) !== out(item)) problems.push(`outputs differ for ${sig(item)}: app(${out(item)}) vs contract(${out(r)})`);
      if (r.stateMutability !== item.stateMutability) problems.push(`mutability differs for ${sig(item)}: ${item.stateMutability} vs ${r.stateMutability}`);
    } else if (item.type === "error") {
      if (!realErrs.has(sig(item as unknown as AbiFunction))) {
        // custom errors defined in OpenZeppelin parents (e.g. EnforcedPause) live in the ABI too; otherwise flag
        problems.push(`missing error ${sig(item)}`);
      }
    }
  }
  return problems;
}

describe("the app's contract interfaces match the compiled contracts", () => {
  const cases: [string, Abi, string][] = [
    ["JanSetuFaucet", faucetAbi as Abi, "faucet"], ["JanSetuRegistry", registryAbi as Abi, "registry"],
    ["AgentStaking", stakingAbi as Abi, "staking"], ["P2PEscrow", escrowAbi as Abi, "escrow"], ["CreditScoreNFT", scoreAbi as Abi, "score"],
    ["MicroCredit", microAbi as Abi, "micro"], ["CollateralLoan", collAbi as Abi, "coll"], ["LoanLiquidityPool", poolAbi as Abi, "pool"],
    ["CommissionManager", commissionsAbi as Abi, "comm"], ["RewardsManager", rewardsAbi as Abi, "rewards"], ["SundayJackpot", jackpotAbi as Abi, "jackpot"], ["InsurancePool", insuranceAbi as Abi, "ins"],
    ["FixedDepositVault", vaultPledgeAbi as Abi, "pledge-fd"], ["DailyVault", vaultPledgeAbi as Abi, "pledge-daily"],
    ["NetworkRanks", ranksAbi as Abi, "ranks"], ["ServiceCommission", serviceAbi as Abi, "service"], ["JanSetuMultiSig", multisigAbi as Abi, "multisig"], ["JanSetuTimelock", timelockAbi as Abi, "timelock"],
    ["DailyVault", dailyAbi as Abi, "daily"], ["RecurringDepositVault", rdAbi as Abi, "rd"], ["FixedDepositVault", fdAbi as Abi, "fd"],
  ];
  test.each(cases)("%s", (name, appAbi) => { expect(conforms(appAbi, load(name))).toEqual([]); });
  test("INRToken (ERC-20 subset)", () => { expect(conforms(erc20Abi as Abi, load("INRToken"))).toEqual([]); });
  test("selectors are computable", () => { expect(toFunctionSelector("claim()")).toMatch(/^0x[0-9a-f]{8}$/); expect(toEventSelector("Transfer(address,address,uint256)")).toMatch(/^0x/); });
});
