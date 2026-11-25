import { getAddress, isAddress, type Address, type Hex } from "viem";
import type { Db } from "./db";
import { dayOf } from "./db";

export type ForwardRequest = { from: Address; to: Address; value: string | bigint; gas: string | bigint; deadline: number; data: Hex; signature: Hex };
export type RelayLimits = { allowedTargets: Set<string>; maxGas: bigint; perAddress: number; global: number };

export class RelayError extends Error {
  constructor(public code: number, message: string) { super(message); }
}

/** Pure checks that run BEFORE anything touches the chain or the relayer's money. */
export function validateRelay(r: ForwardRequest, limits: RelayLimits, nowSec = Math.floor(Date.now() / 1000)) {
  if (!isAddress(r.from) || !isAddress(r.to)) throw new RelayError(400, "Bad address");
  if (!limits.allowedTargets.has(r.to.toLowerCase())) throw new RelayError(403, "That contract is not sponsored");
  if (BigInt(r.value) !== 0n) throw new RelayError(400, "Value transfers are not sponsored");
  const gas = BigInt(r.gas);
  if (gas <= 0n || gas > limits.maxGas) throw new RelayError(400, "Gas limit out of range");
  if (r.deadline < nowSec + 20) throw new RelayError(400, "Request expired");
  if (r.deadline > nowSec + 3600) throw new RelayError(400, "Deadline too far in the future");
  if (!/^0x([0-9a-fA-F]{2})*$/.test(r.data) || r.data.length < 10 || r.data.length > 20_000) throw new RelayError(400, "Bad call data");
  if (!/^0x[0-9a-fA-F]{130}$/.test(r.signature)) throw new RelayError(400, "Bad signature");
}

/** Per-address and global daily budget. Returns false when the budget is spent. */
export function takeBudget(db: Db, address: string, limits: RelayLimits, now = Date.now()): boolean {
  const day = dayOf(now);
  const a = address.toLowerCase();
  const total = (db.prepare("SELECT COALESCE(SUM(n),0) AS n FROM relay_log WHERE day = ?").get(day) as { n: number }).n;
  if (total >= limits.global) return false;
  const mine = (db.prepare("SELECT n FROM relay_log WHERE address = ? AND day = ?").get(a, day) as { n: number } | undefined)?.n ?? 0;
  if (mine >= limits.perAddress) return false;
  db.prepare("INSERT INTO relay_log(address, day, n) VALUES(?,?,1) ON CONFLICT(address, day) DO UPDATE SET n = n + 1").run(a, day);
  return true;
}

export const allowedTargetsFrom = (contracts: Record<string, string>, exclude = ["forwarder", "multisig", "timelock", "treasury", "emergency", "yieldAdapter", "yieldStrategy"]) =>
  new Set(Object.entries(contracts).filter(([k]) => !exclude.includes(k)).map(([, v]) => getAddress(v).toLowerCase()));
