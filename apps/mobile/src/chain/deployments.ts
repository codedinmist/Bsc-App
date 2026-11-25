import { isAddress, type Address } from "viem";
import raw from "./deployments.json";

export type ContractKey = "token" | "faucet" | "registry" | "daily" | "rd" | "fd" | "receipts" | "config" | "forwarder" | "timelock" | "staking" | "escrow" | "treasury" | "emergency" | "commissions" | "rewards" | "pool" | "score" | "micro" | "coll" | "jackpot" | "insurance" | "predictionLp" | "predictionMarket" | "yieldAdapter" | "yieldStrategy" | "ranks" | "service" | "multisig";
const c = (raw.contracts ?? {}) as Partial<Record<ContractKey, string>>;

/** Addresses come from deployments.json, written by `npm run sync:contracts` after the owner deploys. */
export const contracts: Partial<Record<ContractKey, Address>> = Object.fromEntries(
  Object.entries(c).filter(([, v]) => typeof v === "string" && isAddress(v))
) as Partial<Record<ContractKey, Address>>;

export const isDeployed = Boolean(contracts.token && contracts.daily && contracts.rd && contracts.fd && contracts.registry && contracts.faucet);

export function need(key: ContractKey): Address {
  const a = contracts[key];
  if (!a) throw new Error(`Contract "${key}" is not deployed yet`);
  return a;
}

/** Anti-phishing: the app signs transactions ONLY to addresses in the pinned deployment list. */
export function assertAllowedTarget(to: string) {
  const ok = Object.values(contracts).some((a) => a.toLowerCase() === to.toLowerCase());
  if (!ok) throw new Error("Blocked: this address is not a known JanSetu contract.");
}
