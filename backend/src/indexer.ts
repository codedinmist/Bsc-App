import { parseAbi, type Address } from "viem";
import type { Chain } from "./chain";
import type { Config } from "./config";
import type { Db } from "./db";

export const eventsAbi = parseAbi([
  // escrow
  "event OrderCreated(uint256 indexed id, uint8 kind, address indexed locker, address indexed beneficiary, uint256 amount, uint64 deadline)",
  "event OrderReleased(uint256 indexed id, address indexed to, uint256 amount, bool bySignature)",
  "event OrderRefunded(uint256 indexed id, address indexed to, uint256 amount)",
  "event DisputeOpened(uint256 indexed id, address indexed by, bytes32 evidenceHash)",
  "event ResolutionProposed(uint256 indexed id, bool toBeneficiary, address indexed by)",
  "event DisputeFinalised(uint256 indexed id, bool toBeneficiary, uint256 slashed)",
  // vaults
  "event PositionOpened(uint256 indexed id, address indexed owner, uint64 maturityAt)",
  "event PositionSettled(uint256 indexed id, address indexed owner, uint256 principalPaid, uint256 penalty, uint256 rewardPaid, bool matured)",
  // staking
  "event Staked(address indexed agent, uint256 amount, uint256 newStake)",
  "event Slashed(address indexed agent, uint256 amount, address indexed sink, bytes32 reasonHash)",
  // commissions, rewards, credit, insurance, jackpot
  "event ReferrerSet(address indexed customer, address indexed agent)",
  "event BonusPaid(address indexed to, address indexed vault, uint256 indexed id, uint256 amount)",
  "event LoanOpened(uint256 indexed id, address indexed borrower, uint8 tier, uint256 principal, uint256 totalDue)",
  "event Repayment(uint256 indexed id, address indexed payer, uint32 installments, uint256 amount, bool onTime)",
  "event LoanDefaulted(uint256 indexed id, address indexed borrower, uint256 writtenOff)",
  "event Borrowed(uint256 indexed id, address indexed borrower, address vault, uint256 positionId, uint256 collateral, uint256 principal, uint256 owed, uint64 dueAt)",
  "event Liquidated(uint256 indexed id, address indexed by, uint256 seized, uint256 returned)",
  "event ClaimFiled(uint256 indexed id, address indexed user, uint8 kind, uint256 requested)",
  "event ClaimDecided(uint256 indexed id, bool approved, uint256 paid)",
  "event PrizeClaimed(uint256 indexed week, address indexed user, uint256 amount)",
]);

const KEYS = ["escrow", "daily", "rd", "fd", "staking", "commissions", "rewards", "micro", "coll", "insurance", "jackpot"] as const;
const CHUNK = 2000n;

const clean = (v: unknown): unknown => typeof v === "bigint" ? v.toString() : Array.isArray(v) ? v.map(clean) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)])) : v;
const actorsOf = (args: Record<string, unknown>) => "," + Object.values(args).filter((v): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)).map((v) => v.toLowerCase()).join(",") + ",";

export function notify(db: Db, address: string, title: string, body: string, dedupe: string, now = Date.now()) {
  db.prepare("INSERT OR IGNORE INTO notifications(address, title, body, ts, dedupe) VALUES(?,?,?,?,?)").run(address.toLowerCase(), title, body, now, dedupe);
}

const fmt = (wei: unknown) => { const n = Number(BigInt(String(wei)) / 10n ** 16n) / 100; return n.toLocaleString("en-IN", { maximumFractionDigits: 2 }); };

/** Turns an indexed event into user-facing notifications. Pure, so it is easy to test. */
export function eventToNotifications(db: Db, name: string, a: Record<string, string>, dedupe: string) {
  const out: { to: string; title: string; body: string }[] = [];
  const order = (id: string) => db.prepare("SELECT args FROM events WHERE name='OrderCreated' AND json_extract(args,'$.id') = ?").get(id) as { args: string } | undefined;
  if (name === "OrderCreated") out.push({ to: a.beneficiary, title: "New order for you", body: `${fmt(a.amount)} tINR is waiting in escrow (order #${a.id}).` });
  if (name === "OrderReleased") out.push({ to: a.to, title: "tINR received", body: `${fmt(a.amount)} tINR was released to you (order #${a.id}).` });
  if (name === "OrderRefunded") out.push({ to: a.to, title: "Order refunded", body: `${fmt(a.amount)} tINR was returned to you (order #${a.id}).` });
  if (name === "DisputeOpened" || name === "ResolutionProposed" || name === "DisputeFinalised") {
    const o = order(a.id);
    if (o) { const p = JSON.parse(o.args) as Record<string, string>; const t = name === "DisputeOpened" ? "A dispute was opened" : name === "ResolutionProposed" ? "A decision was proposed" : "Dispute settled"; for (const who of [p.locker, p.beneficiary]) out.push({ to: who, title: t, body: `Order #${a.id}. Open the Pay tab to see what you can do.` }); }
  }
  if (name === "LoanDefaulted") out.push({ to: a.borrower, title: "Loan marked in default", body: `Loan #${a.id} was marked in default. Your credit score has dropped.` });
  if (name === "Liquidated") { const row = db.prepare("SELECT args FROM events WHERE name='Borrowed' AND json_extract(args,'$.id') = ?").get(a.id) as { args: string } | undefined; if (row) out.push({ to: (JSON.parse(row.args) as Record<string, string>).borrower, title: "Pledge used for your loan", body: `Loan #${a.id} was overdue, so ${fmt(a.seized)} tINR of your pledged deposit was used.` }); }
  if (name === "ClaimDecided") { const row = db.prepare("SELECT args FROM events WHERE name='ClaimFiled' AND json_extract(args,'$.id') = ?").get(a.id) as { args: string } | undefined; if (row) out.push({ to: (JSON.parse(row.args) as Record<string, string>).user, title: a.approved ? "Insurance claim approved" : "Insurance claim not approved", body: a.approved ? `${fmt(a.paid)} tINR was paid for claim #${a.id}.` : `Claim #${a.id} was not approved.` }); }
  if (name === "Slashed") out.push({ to: a.agent, title: "Part of your stake was taken", body: `${fmt(a.amount)} tINR was slashed after a dispute decision.` });
  out.forEach((n, i) => n.to && notify(db, n.to, n.title, n.body, `${dedupe}:${i}`));
}

export async function pushToDevices(db: Db, addresses: string[]) {
  const tokens = db.prepare(`SELECT token FROM devices WHERE address IN (${addresses.map(() => "?").join(",") || "''"})`).all(...addresses.map((a) => a.toLowerCase())) as { token: string }[];
  if (!tokens.length) return;
  try {
    await fetch("https://exp.host/--/api/v2/push/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(tokens.map((t) => ({ to: t.token, title: "JanSetu", body: "You have a new update.", sound: "default" }))) });
  } catch { /* push is best-effort */ }
}

export async function indexOnce(cfg: Config, chain: Chain, db: Db) {
  if (!cfg.deployment) return { indexed: 0 };
  const addresses = KEYS.map((k) => cfg.deployment!.contracts[k]).filter(Boolean) as Address[];
  if (!addresses.length) return { indexed: 0 };
  const head = await chain.publicClient.getBlockNumber();
  const saved = db.prepare("SELECT v FROM kv WHERE k='lastBlock'").get() as { v: string } | undefined;
  let from = saved ? BigInt(saved.v) + 1n : BigInt(cfg.deployment.block ?? 0);
  let count = 0;
  const tsCache = new Map<bigint, number>();
  const ins = db.prepare("INSERT OR IGNORE INTO events(contract, name, block, tx, log_index, args, actors, ts) VALUES(?,?,?,?,?,?,?,?)");
  const touched = new Set<string>();
  while (from <= head) {
    const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
    // Public RPCs allow at most 10 addresses per log query, so ask in groups of 10.
    const groups: Address[][] = [];
    for (let i = 0; i < addresses.length; i += 10) groups.push(addresses.slice(i, i + 10));
    const logs = (await Promise.all(groups.map((g) => chain.publicClient.getLogs({ address: g, events: eventsAbi, fromBlock: from, toBlock: to })))).flat();
    logs.sort((a, b) => Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)) || (a.logIndex ?? 0) - (b.logIndex ?? 0));
    for (const l of logs) {
      if (l.blockNumber === null || l.transactionHash === null || l.logIndex === null) continue;
      let ts = tsCache.get(l.blockNumber);
      if (ts === undefined) { ts = Number((await chain.publicClient.getBlock({ blockNumber: l.blockNumber })).timestamp); tsCache.set(l.blockNumber, ts); }
      const args = clean(l.args ?? {}) as Record<string, string>;
      const r = ins.run(l.address.toLowerCase(), l.eventName, Number(l.blockNumber), l.transactionHash, l.logIndex, JSON.stringify(args), actorsOf(args), ts);
      if (r.changes) {
        count++;
        eventToNotifications(db, l.eventName, args, `${l.transactionHash}:${l.logIndex}`);
        Object.values(args).forEach((v) => { if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)) touched.add(v.toLowerCase()); });
      }
    }
    db.prepare("INSERT INTO kv(k,v) VALUES('lastBlock',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(to.toString());
    from = to + 1n;
  }
  if (count > 0) void pushToDevices(db, [...touched]);
  return { indexed: count };
}

export function startIndexer(cfg: Config, chain: Chain, db: Db, log: { error: (e: unknown) => void }) {
  let busy = false;
  const tick = async () => { if (busy) return; busy = true; try { await indexOnce(cfg, chain, db); } catch (e) { log.error(e); } finally { busy = false; } };
  void tick();
  return setInterval(tick, 15_000);
}
