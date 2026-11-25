import { publicClient } from "@/chain/client";

type Req = Parameters<typeof publicClient.getLogs>[0];
const STEP = 50_000n;
const MAX_WINDOWS = 220; // about a year of BNB Smart Chain blocks if the node refuses one big query

/** All logs for a filter, newest history included. Tries one query over the whole chain first (most nodes allow it when few logs match), then falls back to scanning in windows. */
export async function getLogsAll(req: Req): Promise<Awaited<ReturnType<typeof publicClient.getLogs>>> {
  try {
    return await publicClient.getLogs({ ...(req as object), fromBlock: 0n, toBlock: "latest" } as never);
  } catch { /* range too large: scan in windows */ }
  const head = await publicClient.getBlockNumber();
  const out: Awaited<ReturnType<typeof publicClient.getLogs>> = [];
  const windows = Array.from({ length: MAX_WINDOWS }, (_, i) => { const to = head - STEP * BigInt(i); return { to, from: to - STEP + 1n < 0n ? 0n : to - STEP + 1n }; }).filter((w) => w.to >= 0n);
  for (let i = 0; i < windows.length; i += 8) {
    const part = await Promise.all(windows.slice(i, i + 8).map((w) => publicClient.getLogs({ ...(req as object), fromBlock: w.from, toBlock: w.to } as never).catch(() => [])));
    for (const p of part) out.push(...(p as never[]));
  }
  return out;
}
