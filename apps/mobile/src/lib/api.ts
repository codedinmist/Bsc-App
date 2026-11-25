/** Optional JanSetu backend (agent search, notifications, history, gas relay). The app works without it. */
export const API_URL: string | undefined = process.env.EXPO_PUBLIC_API_URL || undefined;

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

export type AgentInfo = { address: string; name: string; pincode: string; district: string; stakeOk: boolean; rating: number };
export const api = {
  agents: (q: { pincode?: string; district?: string }) => call<{ agents: AgentInfo[] }>(`/agents?${new URLSearchParams(q as Record<string, string>)}`),
  history: (address: string) => call<{ items: { kind: string; title: string; amount: string; at: number; tx: string }[] }>(`/history/${address}`),
  notifications: (address: string) => call<{ items: { id: string; title: string; body: string; at: number; read: boolean }[] }>(`/notifications/${address}`),
  registerDevice: (address: string, token: string, ts: number, signature: string) => call<{ ok: true }>("/devices", { method: "POST", body: JSON.stringify({ address, token, ts, signature }) }),
  relay: (body: unknown) => call<{ hash: string }>("/relay", { method: "POST", body: JSON.stringify(body) }),
  relayStatus: () => call<{ enabled: boolean; forwarder: string }>("/relay/status"),
  dispute: (body: unknown) => call<{ ok: true; ticket: string }>("/disputes", { method: "POST", body: JSON.stringify(body) }),
  requestKyc: (address: string, ts: number, signature: string) => call<{ status: "approved" | "pending" }>("/kyc", { method: "POST", body: JSON.stringify({ address, ts, signature }) }),
  kycStatus: (address: string) => call<{ desk: boolean; requested: boolean; status: string }>(`/kyc/${address}`),
  listAgent: (body: { address: string; name: string; pincode: string; district: string; ts: number; signature: string }) => call<{ ok: true }>("/agents", { method: "POST", body: JSON.stringify(body) }),
  commissions: (agent: string) => call<{ items: { vault: string; id: string; slot: number; claimable: string }[] }>(`/commissions/${agent}`),
};
