import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

export function openDb(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, contract TEXT NOT NULL, name TEXT NOT NULL, block INTEGER NOT NULL, tx TEXT NOT NULL, log_index INTEGER NOT NULL,
      args TEXT NOT NULL, actors TEXT NOT NULL, ts INTEGER NOT NULL, UNIQUE(tx, log_index)
    );
    CREATE INDEX IF NOT EXISTS ev_actor ON events(actors);
    CREATE TABLE IF NOT EXISTS agents (address TEXT PRIMARY KEY, name TEXT NOT NULL, pincode TEXT NOT NULL, district TEXT NOT NULL, updated INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS ag_pin ON agents(pincode);
    CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, address TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, ts INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0, dedupe TEXT UNIQUE);
    CREATE INDEX IF NOT EXISTS nt_addr ON notifications(address);
    CREATE TABLE IF NOT EXISTS devices (address TEXT NOT NULL, token TEXT NOT NULL, PRIMARY KEY(address, token));
    CREATE TABLE IF NOT EXISTS relay_log (address TEXT NOT NULL, day INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY(address, day));
    CREATE TABLE IF NOT EXISTS kyc_requests (address TEXT PRIMARY KEY, ts INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending');
    CREATE TABLE IF NOT EXISTS disputes (ticket TEXT PRIMARY KEY, order_id TEXT NOT NULL, address TEXT NOT NULL, note TEXT NOT NULL, evidence_hash TEXT NOT NULL, ts INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open');
  `);
  return db;
}

export const dayOf = (ts = Date.now()) => Math.floor(ts / 86_400_000);
