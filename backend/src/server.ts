import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { getAddress, isAddress, keccak256, toHex, verifyMessage, type Address } from "viem";
import { randomBytes } from "node:crypto";
import { loadConfig, type Config } from "./config";
import { openDb, type Db } from "./db";
import { makeChain, forwarderAbi, registryAbi, stakingAbi, commissionsAbi, type Chain } from "./chain";
import { allowedTargetsFrom, RelayError, takeBudget, validateRelay, type RelayLimits } from "./relay";
import { startIndexer } from "./indexer";

const addr = z.string().refine(isAddress, "bad address");
const MAX_SKEW = 10 * 60;

export async function verifySigned(message: string, address: string, signature: string, ts: number, now = Math.floor(Date.now() / 1000)) {
  if (Math.abs(now - ts) > MAX_SKEW) throw new RelayError(400, "Signature is too old");
  const ok = await verifyMessage({ address: address as Address, message, signature: signature as `0x${string}` }).catch(() => false);
  if (!ok) throw new RelayError(401, "Signature does not match");
}

export function buildApp(cfg: Config, chain: Chain, db: Db) {
  const app = Fastify({ logger: { level: process.env.NODE_ENV === "test" ? "silent" : "info", redact: ["req.headers.authorization"] }, bodyLimit: 64 * 1024, trustProxy: true });
  const contracts = cfg.deployment?.contracts ?? {};
  const limits: RelayLimits = { allowedTargets: allowedTargetsFrom(contracts), maxGas: cfg.relayMaxGas, perAddress: cfg.relayPerAddress, global: cfg.relayGlobal };

  app.register(helmet);
  app.register(cors, { origin: true });
  app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  app.setErrorHandler((err: unknown, _req, reply) => {
    const e = err as { code?: number; statusCode?: number; message?: string; issues?: unknown };
    if (err instanceof RelayError) return reply.code(err.code).send({ error: err.message });
    if (e.issues) return reply.code(400).send({ error: "Invalid request" });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message });
    app.log.error(err);
    return reply.code(500).send({ error: "Something went wrong" });
  });

  app.get("/health", async () => ({ ok: true, chainId: 97, deployed: !!cfg.deployment, relay: !!chain.wallet }));

  // ------------------------------------------------------------- gas relay
  app.get("/relay/status", async () => ({ enabled: !!(chain.wallet && contracts.forwarder), forwarder: contracts.forwarder ?? null }));

  app.post("/relay", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    if (!chain.wallet || !chain.account || !contracts.forwarder) throw new RelayError(503, "Gas sponsorship is not enabled");
    const body = z.object({
      from: addr, to: addr, value: z.union([z.string(), z.number()]).default("0"), gas: z.union([z.string(), z.number()]),
      deadline: z.number().int(), data: z.string(), signature: z.string(),
    }).parse(req.body);
    const r = { ...body, from: getAddress(body.from), to: getAddress(body.to), data: body.data as `0x${string}`, signature: body.signature as `0x${string}`, value: String(body.value), gas: String(body.gas) };
    validateRelay(r, limits);
    const request = { from: r.from, to: r.to, value: BigInt(r.value), gas: BigInt(r.gas), deadline: r.deadline, data: r.data, signature: r.signature };
    const forwarder = getAddress(contracts.forwarder);
    if (!(await chain.publicClient.readContract({ address: forwarder, abi: forwarderAbi, functionName: "verify", args: [request] }))) throw new RelayError(400, "Signature check failed");
    const bal = await chain.publicClient.getBalance({ address: chain.account.address });
    if (bal < 5_000_000_000_000_000n) throw new RelayError(503, "Sponsorship is paused: the relayer needs more test BNB");
    if (!takeBudget(db, r.from, limits)) throw new RelayError(429, "Daily free-transaction limit reached");
    // simulate first so a failing call never costs the relayer gas
    try { await chain.publicClient.simulateContract({ account: chain.account, address: forwarder, abi: forwarderAbi, functionName: "execute", args: [request] }); }
    catch { throw new RelayError(400, "The transaction would fail, so it was not sent"); }
    const hash = await chain.wallet.writeContract({ address: forwarder, abi: forwarderAbi, functionName: "execute", args: [request], chain: chain.wallet.chain, account: chain.account });
    return { hash };
  });

  // ------------------------------------------------------------- KYC desk (TESTNET demo)
  // On a real launch an operator checks documents off-chain and then calls registry.setKyc. On testnet the desk can approve
  // automatically (TESTNET_KYC_DESK=1 and OPS_PRIVATE_KEY). Without it, requests are just stored for `ops.mjs kyc-all`.
  app.post("/kyc", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const b = z.object({ address: addr, ts: z.number().int(), signature: z.string() }).parse(req.body);
    const a = getAddress(b.address);
    await verifySigned(`JanSetu KYC request\naddress:${a.toLowerCase()}\nts:${b.ts}`, a, b.signature, b.ts);
    if (!contracts.registry) throw new RelayError(503, "Not deployed");
    const reg = getAddress(contracts.registry);
    if (!(await chain.publicClient.readContract({ address: reg, abi: registryAbi, functionName: "isRegistered", args: [a] }))) throw new RelayError(400, "Join JanSetu first");
    if (await chain.publicClient.readContract({ address: reg, abi: registryAbi, functionName: "isKyc", args: [a] })) return { status: "approved" as const };
    db.prepare("INSERT INTO kyc_requests(address, ts, status) VALUES(?,?, 'pending') ON CONFLICT(address) DO UPDATE SET ts=excluded.ts").run(a.toLowerCase(), Date.now());
    if (!cfg.kycDesk || !chain.opsWallet || !chain.opsAccount) return { status: "pending" as const };
    const hash = await chain.opsWallet.writeContract({ address: reg, abi: registryAbi, functionName: "setKyc", args: [a, true], chain: chain.opsWallet.chain, account: chain.opsAccount });
    await chain.publicClient.waitForTransactionReceipt({ hash });
    db.prepare("UPDATE kyc_requests SET status='approved' WHERE address=?").run(a.toLowerCase());
    return { status: "approved" as const, hash };
  });
  app.get("/kyc/:address", async (req) => {
    const { address } = z.object({ address: addr }).parse(req.params);
    const row = db.prepare("SELECT status FROM kyc_requests WHERE address=?").get(address.toLowerCase()) as { status: string } | undefined;
    return { desk: cfg.kycDesk && !!chain.opsWallet, requested: !!row, status: row?.status ?? "none" };
  });

  // ------------------------------------------------------------- agents
  app.post("/agents", async (req) => {
    const b = z.object({ address: addr, name: z.string().trim().min(2).max(60), pincode: z.string().regex(/^\d{6}$/), district: z.string().trim().min(2).max(60), ts: z.number().int(), signature: z.string() }).parse(req.body);
    const msg = `JanSetu agent profile\naddress:${b.address.toLowerCase()}\nname:${b.name}\npincode:${b.pincode}\ndistrict:${b.district}\nts:${b.ts}`;
    await verifySigned(msg, b.address, b.signature, b.ts);
    if (contracts.registry && !(await chain.publicClient.readContract({ address: getAddress(contracts.registry), abi: registryAbi, functionName: "isActiveAgent", args: [getAddress(b.address)] }))) throw new RelayError(403, "Only verified, active agents can list themselves");
    db.prepare("INSERT INTO agents(address,name,pincode,district,updated) VALUES(?,?,?,?,?) ON CONFLICT(address) DO UPDATE SET name=excluded.name,pincode=excluded.pincode,district=excluded.district,updated=excluded.updated").run(b.address.toLowerCase(), b.name, b.pincode, b.district, Date.now());
    return { ok: true };
  });

  app.get("/agents", async (req) => {
    const q = z.object({ pincode: z.string().regex(/^\d{4,6}$/).optional(), district: z.string().max(60).optional() }).parse(req.query);
    const rows = (q.pincode
      ? db.prepare("SELECT * FROM agents WHERE pincode LIKE ? ORDER BY updated DESC LIMIT 25").all(`${q.pincode}%`)
      : q.district ? db.prepare("SELECT * FROM agents WHERE LOWER(district) = LOWER(?) ORDER BY updated DESC LIMIT 25").all(q.district)
      : []) as { address: string; name: string; pincode: string; district: string }[];
    const agents = await Promise.all(rows.map(async (a) => {
      let stakeOk = false;
      if (contracts.staking) stakeOk = await chain.publicClient.readContract({ address: getAddress(contracts.staking), abi: stakingAbi, functionName: "isEligible", args: [getAddress(a.address)] }).catch(() => false);
      return { address: getAddress(a.address), name: a.name, pincode: a.pincode, district: a.district, stakeOk, rating: 0 };
    }));
    return { agents: agents.filter((a) => a.stakeOk) };
  });

  // ------------------------------------------------------------- history & notifications
  const label: Record<string, string> = { PositionOpened: "Account opened", PositionSettled: "Account settled", OrderCreated: "Agent order created", OrderReleased: "Order released", OrderRefunded: "Order refunded", DisputeOpened: "Dispute opened", LoanOpened: "Merchant loan received", Repayment: "Loan repayment", Borrowed: "Loan against savings", BonusPaid: "Bonus received", PrizeClaimed: "Draw prize claimed", ClaimDecided: "Insurance claim decided", Staked: "Stake added" };
  app.get("/history/:address", async (req) => {
    const { address } = z.object({ address: addr }).parse(req.params);
    const rows = db.prepare("SELECT name, args, tx, ts FROM events WHERE actors LIKE ? ORDER BY block DESC, log_index DESC LIMIT 100").all(`%,${address.toLowerCase()},%`) as { name: string; args: string; tx: string; ts: number }[];
    return { items: rows.map((r) => { const a = JSON.parse(r.args) as Record<string, string>; return { kind: r.name, title: label[r.name] ?? r.name, amount: a.amount ?? a.principal ?? a.paid ?? "0", at: r.ts, tx: r.tx }; }) };
  });
  app.get("/notifications/:address", async (req) => {
    const { address } = z.object({ address: addr }).parse(req.params);
    const rows = db.prepare("SELECT id, title, body, ts, read FROM notifications WHERE address = ? ORDER BY id DESC LIMIT 50").all(address.toLowerCase()) as { id: number; title: string; body: string; ts: number; read: number }[];
    return { items: rows.map((r) => ({ id: String(r.id), title: r.title, body: r.body, at: Math.floor(r.ts / 1000), read: !!r.read })) };
  });
  app.post("/devices", async (req) => {
    const b = z.object({ address: addr, token: z.string().regex(/^ExponentPushToken\[[\w-]+\]$/), ts: z.number().int(), signature: z.string() }).parse(req.body);
    await verifySigned(`JanSetu device\naddress:${b.address.toLowerCase()}\ntoken:${b.token}\nts:${b.ts}`, b.address, b.signature, b.ts);
    db.prepare("INSERT OR IGNORE INTO devices(address, token) VALUES(?,?)").run(b.address.toLowerCase(), b.token);
    return { ok: true };
  });

  // ------------------------------------------------------------- disputes
  app.post("/disputes", async (req) => {
    const b = z.object({ orderId: z.string().regex(/^\d{1,12}$/), address: addr, note: z.string().trim().min(5).max(1000), ts: z.number().int(), signature: z.string() }).parse(req.body);
    await verifySigned(`JanSetu dispute\norder:${b.orderId}\nnote:${keccak256(toHex(b.note))}\nts:${b.ts}`, b.address, b.signature, b.ts);
    const row = db.prepare("SELECT args FROM events WHERE name='OrderCreated' AND json_extract(args,'$.id') = ?").get(b.orderId) as { args: string } | undefined;
    if (!row) throw new RelayError(404, "Order not found (it may not be indexed yet)");
    const o = JSON.parse(row.args) as { locker: string; beneficiary: string };
    if (![o.locker, o.beneficiary].map((x) => x.toLowerCase()).includes(b.address.toLowerCase())) throw new RelayError(403, "You are not part of this order");
    const ticket = randomBytes(6).toString("hex");
    const evidenceHash = keccak256(toHex(`${b.orderId}:${b.note}:${ticket}`));
    db.prepare("INSERT INTO disputes(ticket, order_id, address, note, evidence_hash, ts) VALUES(?,?,?,?,?,?)").run(ticket, b.orderId, b.address.toLowerCase(), b.note, evidenceHash, Date.now());
    return { ok: true, ticket, evidenceHash };
  });
  app.get("/disputes", async (req) => {
    const t = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (!cfg.adminToken || t !== cfg.adminToken) throw new RelayError(401, "Not allowed");
    return { items: db.prepare("SELECT ticket, order_id AS orderId, address, note, evidence_hash AS evidenceHash, ts, status FROM disputes ORDER BY ts DESC LIMIT 200").all() };
  });

  // ------------------------------------------------------------- commissions
  app.get("/commissions/:agent", async (req) => {
    const { agent } = z.object({ agent: addr }).parse(req.params);
    if (!contracts.commissions) return { items: [] };
    const customers = (db.prepare("SELECT args FROM events WHERE name='ReferrerSet' AND json_extract(args,'$.agent') = ? COLLATE NOCASE").all(agent) as { args: string }[]).map((r) => (JSON.parse(r.args) as { customer: string }).customer);
    const vaults = ["daily", "rd", "fd"].map((k) => contracts[k]).filter(Boolean).map((a) => a.toLowerCase());
    const pairs: { vault: string; id: string }[] = [];
    for (const c of customers.slice(0, 200)) {
      const rows = db.prepare("SELECT contract, args FROM events WHERE name='PositionOpened' AND json_extract(args,'$.owner') = ? COLLATE NOCASE").all(c) as { contract: string; args: string }[];
      for (const r of rows) if (vaults.includes(r.contract)) pairs.push({ vault: getAddress(r.contract), id: (JSON.parse(r.args) as { id: string }).id });
    }
    const res = await Promise.all(pairs.slice(0, 200).map((p) => chain.publicClient.readContract({ address: getAddress(contracts.commissions!), abi: commissionsAbi, functionName: "claimable", args: [p.vault as Address, BigInt(p.id), 0] }).catch(() => 0n)));
    return { items: pairs.map((p, i) => ({ ...p, slot: 0, claimable: String(res[i]) })).filter((x) => x.claimable !== "0") };
  });

  return app;
}

async function main() {
  const cfg = loadConfig();
  const chain = makeChain(cfg);
  const db = openDb(cfg.dbFile);
  const app = buildApp(cfg, chain, db);
  if (!cfg.deployment) app.log.warn("No deployment file found: relay and indexing are idle until you deploy and set DEPLOYMENTS_FILE.");
  if (!cfg.relayerKey) app.log.warn("RELAYER_PRIVATE_KEY not set: gas sponsorship is OFF (users pay their own test BNB).");
  startIndexer(cfg, chain, db, app.log);
  await app.listen({ port: cfg.port, host: "0.0.0.0" });
}
if (process.argv[1] && process.argv[1].endsWith("server.ts")) main().catch((e) => { console.error(e); process.exit(1); });
