import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { keccak256, toHex } from "viem";
import { openDb } from "../src/db";
import { validateRelay, takeBudget, RelayError, type RelayLimits } from "../src/relay";
import { buildApp } from "../src/server";
import { eventToNotifications } from "../src/indexer";
import { loadConfig } from "../src/config";
import { makeChain } from "../src/chain";

const T = "0x" + "11".repeat(20);
const limits: RelayLimits = { allowedTargets: new Set([T]), maxGas: 1_500_000n, perAddress: 3, global: 5 };
const good = { from: "0x" + "22".repeat(20), to: T, value: "0", gas: "300000", deadline: 2_000_000_100, data: "0xdeadbeef", signature: "0x" + "ab".repeat(65) } as unknown as { from: string; signature: string };
const NOW = 2_000_000_000;

test("relay accepts a well-formed request", () => { validateRelay(good as never, limits, NOW); });
test("relay refuses unknown contracts, value, huge gas, stale and far deadlines", () => {
  const bad = (patch: object, msg: RegExp) => assert.throws(() => validateRelay({ ...(good as object), ...patch } as never, limits, NOW), (e: unknown) => e instanceof RelayError && msg.test(e.message));
  bad({ to: "0x" + "33".repeat(20) }, /not sponsored/);
  bad({ value: "1" }, /Value/);
  bad({ gas: "9000000" }, /Gas/);
  bad({ deadline: NOW + 5 }, /expired/);
  bad({ deadline: NOW + 99999 }, /too far/);
  bad({ data: "0x12" }, /call data/);
  bad({ signature: "0x12" }, /signature/);
});
test("relay budget is per address and global", () => {
  const db = openDb(":memory:");
  assert.equal(takeBudget(db, "0xA", limits, 1e12), true);
  assert.equal(takeBudget(db, "0xa", limits, 1e12), true);
  assert.equal(takeBudget(db, "0xA", limits, 1e12), true);
  assert.equal(takeBudget(db, "0xa", limits, 1e12), false); // 4th for same address
  assert.equal(takeBudget(db, "0xb", limits, 1e12), true);
  assert.equal(takeBudget(db, "0xc", limits, 1e12), true);
  assert.equal(takeBudget(db, "0xd", limits, 1e12), false); // global of 5 reached
  assert.equal(takeBudget(db, "0xa", limits, 1e12 + 86_400_000), true); // next day
});

function app() {
  const cfg = { ...loadConfig({} as NodeJS.ProcessEnv), adminToken: "x".repeat(30) };
  const db = openDb(":memory:");
  return { a: buildApp(cfg, makeChain(cfg), db), db };
}

test("relay is off without a relayer key", async () => {
  const { a } = app();
  const r = await a.inject({ method: "POST", url: "/relay", payload: { from: good.from, to: T, gas: "1", deadline: 1, data: "0x12345678", signature: good.signature } });
  assert.equal(r.statusCode, 503);
  assert.equal((await a.inject({ url: "/relay/status" })).json().enabled, false);
});

test("disputes need a valid signature from an order party, and ops can read tickets only with the token", async () => {
  const { a, db } = app();
  const alice = privateKeyToAccount(generatePrivateKey()); const bob = privateKeyToAccount(generatePrivateKey()); const eve = privateKeyToAccount(generatePrivateKey());
  db.prepare("INSERT INTO events(contract,name,block,tx,log_index,args,actors,ts) VALUES('c','OrderCreated',1,'0x1',0,?,?,1)").run(JSON.stringify({ id: "7", locker: alice.address, beneficiary: bob.address, amount: "1" }), `,${alice.address.toLowerCase()},${bob.address.toLowerCase()},`);
  const note = "Agent took my cash and is not releasing";
  const ts = Math.floor(Date.now() / 1000);
  const send = async (who: typeof alice, signer = who) => {
    const signature = await signer.signMessage({ message: `JanSetu dispute\norder:7\nnote:${keccak256(toHex(note))}\nts:${ts}` });
    return a.inject({ method: "POST", url: "/disputes", payload: { orderId: "7", address: who.address, note, ts, signature } });
  };
  assert.equal((await send(eve)).statusCode, 403);          // not a party
  assert.equal((await send(bob, eve)).statusCode, 401);     // forged signature
  const ok = await send(bob);
  assert.equal(ok.statusCode, 200);
  assert.match(ok.json().evidenceHash, /^0x[0-9a-f]{64}$/);
  assert.equal((await a.inject({ url: "/disputes" })).statusCode, 401);
  const list = await a.inject({ url: "/disputes", headers: { authorization: "Bearer " + "x".repeat(30) } });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().items.length, 1);
});

test("old signatures are rejected", async () => {
  const { a } = app();
  const acc = privateKeyToAccount(generatePrivateKey());
  const ts = Math.floor(Date.now() / 1000) - 3600;
  const signature = await acc.signMessage({ message: `JanSetu device\naddress:${acc.address.toLowerCase()}\ntoken:ExponentPushToken[abc]\nts:${ts}` });
  const r = await a.inject({ method: "POST", url: "/devices", payload: { address: acc.address, token: "ExponentPushToken[abc]", ts, signature } });
  assert.equal(r.statusCode, 400);
});

test("events become notifications once, for the right people", () => {
  const { db } = app();
  eventToNotifications(db, "OrderCreated", { id: "1", locker: "0xaaa", beneficiary: "0xbbb", amount: "5000000000000000000", kind: "0", deadline: "1" }, "t:1");
  eventToNotifications(db, "OrderCreated", { id: "1", locker: "0xaaa", beneficiary: "0xbbb", amount: "5000000000000000000", kind: "0", deadline: "1" }, "t:1");
  const rows = db.prepare("SELECT address, title FROM notifications").all() as { address: string; title: string }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].address, "0xbbb");
});

test("agent search validates input and hides unstaked agents when no chain", async () => {
  const { a } = app();
  assert.equal((await a.inject({ url: "/agents?pincode=ab" })).statusCode, 400);
  const r = await a.inject({ url: "/agents?pincode=560001" });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json().agents, []);
});

test("health responds", async () => { assert.equal((await app().a.inject({ url: "/health" })).json().ok, true); });

import fs from "node:fs";
import path from "node:path";
import { eventsAbi } from "../src/indexer";

test("every event the indexer listens to exists, with the same types, in a compiled contract", () => {
  const dir = path.join(import.meta.dirname, "..", "..", "packages", "abi", "abis");
  const real = new Set<string>();
  for (const f of fs.readdirSync(dir)) for (const x of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { type: string; name: string; inputs: { type: string; indexed: boolean }[] }[])
    if (x.type === "event") real.add(`${x.name}(${x.inputs.map((i) => `${i.type}${i.indexed ? "!" : ""}`).join(",")})`);
  const missing = eventsAbi.filter((e) => e.type === "event").map((e) => `${e.name}(${(e.inputs as readonly { type: string; indexed?: boolean }[]).map((i) => `${i.type}${i.indexed ? "!" : ""}`).join(",")})`).filter((s) => !real.has(s));
  assert.deepEqual(missing, []);
});

test("KYC desk: needs a fresh signature from the wallet, stays pending without a desk key, never approves strangers", async () => {
  const { a } = app();
  const acc = privateKeyToAccount(generatePrivateKey()); const eve = privateKeyToAccount(generatePrivateKey());
  const ts = Math.floor(Date.now() / 1000);
  const msg = `JanSetu KYC request\naddress:${acc.address.toLowerCase()}\nts:${ts}`;
  const forged = await a.inject({ method: "POST", url: "/kyc", payload: { address: acc.address, ts, signature: await eve.signMessage({ message: msg }) } });
  assert.equal(forged.statusCode, 401);
  const stale = await a.inject({ method: "POST", url: "/kyc", payload: { address: acc.address, ts: ts - 3600, signature: await acc.signMessage({ message: `JanSetu KYC request\naddress:${acc.address.toLowerCase()}\nts:${ts - 3600}` }) } });
  assert.equal(stale.statusCode, 400);
  const ok = await a.inject({ method: "POST", url: "/kyc", payload: { address: acc.address, ts, signature: await acc.signMessage({ message: msg }) } });
  assert.equal(ok.statusCode, 503);                                  // valid signature, but no contracts are deployed in this test
  const st = await a.inject({ url: `/kyc/${acc.address}` });
  assert.equal(st.json().desk, false);
});
