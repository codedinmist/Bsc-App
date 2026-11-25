import { encodeFunctionData, type Abi, type Address, type Hash } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { publicClient } from "./client";
import { chain } from "./config";
import { contracts } from "./deployments";
import { api, API_URL } from "@/lib/api";

const forwarderAbi = [{ type: "function", name: "nonces", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] }] as const;
const TYPES = { ForwardRequest: [
  { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "gas", type: "uint256" },
  { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint48" }, { name: "data", type: "bytes" },
] } as const;

let cache: { at: number; on: boolean } | null = null;
/** True when the backend is reachable and sponsors gas. Cached for 5 minutes. */
export async function relayEnabled(): Promise<boolean> {
  if (!API_URL || !contracts.forwarder) return false;
  if (cache && Date.now() - cache.at < 300_000) return cache.on;
  try { const s = await api.relayStatus(); cache = { at: Date.now(), on: s.enabled && s.forwarder.toLowerCase() === contracts.forwarder.toLowerCase() }; }
  catch { cache = { at: Date.now(), on: false }; }
  return cache.on;
}

/**
 * Signs an EIP-712 ForwardRequest and sends it to the backend, which pays the network fee.
 * Returns the transaction hash, or null if sponsorship is not available (the caller then pays its own fee).
 */
export async function sendViaRelay(account: PrivateKeyAccount, to: Address, abi: Abi, functionName: string, args: readonly unknown[] | undefined): Promise<Hash | null> {
  if (!(await relayEnabled())) return null;
  try {
    const forwarder = contracts.forwarder!;
    const data = encodeFunctionData({ abi, functionName, args } as never);
    const nonce = await publicClient.readContract({ address: forwarder, abi: forwarderAbi, functionName: "nonces", args: [account.address] });
    const deadline = Math.floor(Date.now() / 1000) + 15 * 60;
    const req = { from: account.address, to, value: 0n, gas: 800_000n, nonce, deadline, data };
    const signature = await account.signTypedData({ domain: { name: "JanSetuForwarder", version: "1", chainId: chain.id, verifyingContract: forwarder }, types: TYPES, primaryType: "ForwardRequest", message: req });
    const { hash } = await api.relay({ from: req.from, to, value: "0", gas: "800000", deadline, data, signature });
    return hash as Hash;
  } catch {
    cache = null; // re-check next time
    return null;
  }
}
