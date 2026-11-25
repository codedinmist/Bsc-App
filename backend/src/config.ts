import fs from "node:fs";
import path from "node:path";
import type { Address } from "viem";

export type Deployment = { chainId: number; block?: number; contracts: Record<string, Address> };

const num = (v: string | undefined, d: number) => (v && Number.isFinite(+v) ? +v : d);

export function loadConfig(env = process.env) {
  const file = path.resolve(env.DEPLOYMENTS_FILE ?? "../contracts/deployments/bscTestnet.json");
  let deployment: Deployment | null = null;
  if (fs.existsSync(file)) {
    deployment = JSON.parse(fs.readFileSync(file, "utf8")) as Deployment;
    // Safety: this backend only ever talks to BNB Smart Chain TESTNET.
    if (deployment.chainId !== 97) throw new Error(`Refusing to start: deployment is for chain ${deployment.chainId}, expected 97 (BNB Testnet).`);
  }
  return {
    port: num(env.PORT, 8080),
    rpcUrl: env.RPC_URL ?? "https://bsc-testnet-rpc.publicnode.com",
    deployment,
    relayerKey: env.RELAYER_PRIVATE_KEY && /^0x[0-9a-fA-F]{64}$/.test(env.RELAYER_PRIVATE_KEY) ? (env.RELAYER_PRIVATE_KEY as `0x${string}`) : null,
    // TESTNET ONLY: a "KYC desk" that approves identity checks automatically so demos need no manual step.
    opsKey: env.OPS_PRIVATE_KEY && /^0x[0-9a-fA-F]{64}$/.test(env.OPS_PRIVATE_KEY) ? (env.OPS_PRIVATE_KEY as `0x${string}`) : null,
    kycDesk: env.TESTNET_KYC_DESK === "1",
    adminToken: env.ADMIN_TOKEN && env.ADMIN_TOKEN.length >= 24 ? env.ADMIN_TOKEN : null,
    relayPerAddress: num(env.RELAY_PER_ADDRESS_PER_DAY, 60),
    relayGlobal: num(env.RELAY_GLOBAL_PER_DAY, 5000),
    relayMaxGas: BigInt(num(env.RELAY_MAX_GAS, 1_500_000)),
    dbFile: env.DB_FILE ?? "./data/jansetu.db",
  };
}
export type Config = ReturnType<typeof loadConfig>;
