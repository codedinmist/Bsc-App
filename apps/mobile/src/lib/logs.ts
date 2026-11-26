import { publicClient } from "@/chain/client";

type Req = Parameters<typeof publicClient.getLogs>[0];
const STEP = 40_000n; // public nodes reject ranges at or near 50,000 blocks
const MAX_WINDOWS = 260; // about a year of BNB Smart Chain testnet blocks if the node refuses one big query

/** All logs for a filter, newest history included. Tries one query over the whole chain first (most nodes allow it when few logs match), then falls back to scanning in windows. */
export async function getLogsAll(req: Req): Promise<Awaited<ReturnType<typeof publicClient.getLogs>>> {
  try {
    return await publicClient.getLogs({ ...(req as object), fromBlock: 0n, toBlock: "latest" } as never);
  } catch { /* range too large: scan in windows */ }
  const head = await publicClient.getBlockNumber();
  const out: Awaited<ReturnType<typeof publicClient.getLogs>> = [];
  const windows = Array.from({ length: MAX_WINDOWS }, (_, i) => { const to = head - STEP * BigInt(i); return { to, from: to - STEP + 1n < 0n ? 0n : to - STEP + 1n }; }).filter((w) => w.to >= 0n);
  const one = async (w: { from: bigint; to: bigint }) => {
    for (let t = 0; t < 3; t++) {
      try { return (await publicClient.getLogs({ ...(req as object), fromBlock: w.from, toBlock: w.to } as never)) as never[]; }
      catch { await new Promise((r) => setTimeout(r, 400 * (t + 1))); }
    }
    return null;
  };
  let failed = 0;
  for (let i = 0; i < windows.length; i += 5) {
    const part = await Promise.all(windows.slice(i, i + 5).map(one));
    for (const p of part) { if (p) out.push(...p); else failed++; }
  }
  if (failed > windows.length / 2) throw new Error("Could not read history");
  return out;
}
