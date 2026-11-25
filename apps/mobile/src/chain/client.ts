import { createPublicClient, http } from "viem";
import { chain, RPC_URL } from "./config";

export const publicClient = createPublicClient({ chain, transport: http(RPC_URL, { timeout: 15_000, retryCount: 2 }) });
