import { bscTestnet } from "viem/chains";

export const chain = bscTestnet; // chainId 97. The app refuses to talk to any other chain.
export const RPC_URL = process.env.EXPO_PUBLIC_RPC_URL ?? "https://bsc-testnet-rpc.publicnode.com";
export const EXPLORER = "https://testnet.bscscan.com";
export const BNB_TESTNET_FAUCET = "https://www.bnbchain.org/en/testnet-faucet";
export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (a: string) => `${EXPLORER}/address/${a}`;
