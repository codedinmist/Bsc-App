import { createPublicClient, createWalletClient, http, parseAbi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import type { Config } from "./config";

export const forwarderAbi = parseAbi([
  "function nonces(address) view returns (uint256)",
  "function verify((address from, address to, uint256 value, uint256 gas, uint48 deadline, bytes data, bytes signature) request) view returns (bool)",
  "function execute((address from, address to, uint256 value, uint256 gas, uint48 deadline, bytes data, bytes signature) request) payable",
]);
export const registryAbi = parseAbi(["function isActiveAgent(address) view returns (bool)", "function isRegistered(address) view returns (bool)", "function isKyc(address) view returns (bool)", "function setKyc(address account, bool verified)"]);
export const stakingAbi = parseAbi(["function isEligible(address) view returns (bool)"]);
export const commissionsAbi = parseAbi(["function claimable(address vault, uint256 id, uint8 slot) view returns (uint256)"]);

export function makeChain(cfg: Config) {
  const publicClient = createPublicClient({ chain: bscTestnet, transport: http(cfg.rpcUrl, { timeout: 15_000, retryCount: 2 }) });
  const account = cfg.relayerKey ? privateKeyToAccount(cfg.relayerKey) : null;
  const wallet = account ? createWalletClient({ account, chain: bscTestnet, transport: http(cfg.rpcUrl) }) : null;
  const opsAccount = cfg.opsKey ? privateKeyToAccount(cfg.opsKey) : null;
  const opsWallet = opsAccount ? createWalletClient({ account: opsAccount, chain: bscTestnet, transport: http(cfg.rpcUrl) }) : null;
  return { publicClient, wallet, account, opsWallet, opsAccount };
}
export type Chain = ReturnType<typeof makeChain>;
export type { Address };
