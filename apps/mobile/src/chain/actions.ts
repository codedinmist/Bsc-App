import type { Address } from "viem";
import { erc20Abi } from "./abis";
import { publicClient } from "./client";
import { need } from "./deployments";
import type { Step } from "./tx";

/** Adds an exact-amount approval step only if the current allowance is too low. No unlimited approvals. */
export async function approvalSteps(owner: Address, spender: Address, amount: bigint, label = "Allow JanSetu to use your tINR"): Promise<Step[]> {
  const token = need("token");
  const allowance = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
  if (allowance >= amount) return [];
  return [{ label, address: token, abi: erc20Abi as never, functionName: "approve", args: [spender, amount] }];
}

export const DAY = 86400;
export const MONTH = 30 * DAY; // matches the contract's 30-day month
