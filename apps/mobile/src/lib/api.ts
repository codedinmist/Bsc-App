/** Optional JanSetu backend (agent search, notifications, history, gas relay). The app works without it. */
const RAW_URL = process.env.EXPO_PUBLIC_API_URL || undefined;
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:|\/|$)/;
/** Real builds only ever talk to the server over HTTPS. Plain HTTP is allowed only for a developer's own machine. */
export const API_URL: string | undefined = RAW_URL && (/^https:\/\//.test(RAW_URL) || (typeof __DEV__ !== "undefined" && __DEV__ && LOCAL.test(RAW_URL))) ? RAW_URL.replace(/\/$/, "") : undefined;

type Session = { token: string; exp: number };
let sessionProvider: ((address: string) => Promise<Session>) | null = null;
/** Registered once at start-up. Opening a session needs the person to confirm with fingerprint, face or PIN. */
export const setSessionProvider = (f: (address: string) => Promise<Session>) => { sessionProvider = f; };
const sessions = new Map<string, Session>();

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_URL) throw new Error("Backend not connected");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10_000);
  try {
    const r = await fetch(`${API_URL}${path}`, { ...init, signal: ctl.signal, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Server error ${r.status}`);
    return (await r.json()) as T;
  } finally { clearTimeout(t); }
}

/** Private reads (history, notifications, commissions) carry a short-lived session for that address. */
async function authed<T>(address: string, path: string): Promise<T> {
  const key = address.toLowerCase();
  const token = async () => {
    const s = sessions.get(key);
    if (s && s.exp > Date.now() / 1000 + 60) return s.token;
    if (!sessionProvider) throw new Error("Backend not connected");
    const n = await sessionProvider(address);
    sessions.set(key, n);
    return n.token;
  };
  try { return await call<T>(path, { headers: { authorization: `Bearer ${await token()}` } }); }
  catch (e) {
    if (e instanceof Error && /confirm it is you/i.test(e.message)) { sessions.delete(key); return call<T>(path, { headers: { authorization: `Bearer ${await token()}` } }); }
    throw e;
  }
}

export type AgentInfo = { address: string; name: string; pincode: string; district: string; stakeOk: boolean; rating: number };
export const api = {
  agents: (q: { pincode?: string; district?: string }) => call<{ agents: AgentInfo[] }>(`/agents?${new URLSearchParams(q as Record<string, string>)}`),
  history: (address: string) => authed<{ items: { kind: string; title: string; amount: string; at: number; tx: string }[] }>(address, `/history/${address}`),
  notifications: (address: string) => authed<{ items: { id: string; title: string; body: string; at: number; read: boolean }[] }>(address, `/notifications/${address}`),
  session: (address: string, ts: number, signature: string) => call<Session>("/session", { method: "POST", body: JSON.stringify({ address, ts, signature }) }),
  registerDevice: (address: string, token: string, ts: number, signature: string) => call<{ ok: true }>("/devices", { method: "POST", body: JSON.stringify({ address, token, ts, signature }) }),
  relay: (body: unknown) => call<{ hash: string }>("/relay", { method: "POST", body: JSON.stringify(body) }),
  relayStatus: () => call<{ enabled: boolean; forwarder: string }>("/relay/status"),
  dispute: (body: unknown) => call<{ ok: true; ticket: string }>("/disputes", { method: "POST", body: JSON.stringify(body) }),
  requestKyc: (address: string, ts: number, signature: string) => call<{ status: "approved" | "pending" }>("/kyc", { method: "POST", body: JSON.stringify({ address, ts, signature }) }),
  kycStatus: (address: string) => call<{ desk: boolean; requested: boolean; status: string }>(`/kyc/${address}`),
  listAgent: (body: { address: string; name: string; pincode: string; district: string; ts: number; signature: string }) => call<{ ok: true }>("/agents", { method: "POST", body: JSON.stringify(body) }),
  commissions: (agent: string) => authed<{ items: { vault: string; id: string; slot: number; claimable: string }[] }>(agent, `/commissions/${agent}`),
};
