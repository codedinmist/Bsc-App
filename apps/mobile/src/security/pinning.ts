import { addSslPinningErrorListener, initializeSslPinning, isSslPinningAvailable } from "react-native-ssl-public-key-pinning";

export type PinConfig = Record<string, { includeSubdomains?: boolean; publicKeyHashes: string[]; expirationDate?: string }>;
export type PinStatus = { state: "off" | "on" | "error"; hosts: string[]; detail?: string; violations: string[] };

const status: PinStatus = { state: "off", hosts: [], violations: [] };
export const pinStatus = () => status;

/** Parses EXPO_PUBLIC_PINS (JSON). Each host needs at least two SPKI hashes (one live, one backup). Invalid entries are dropped. */
export function parsePins(raw: string | undefined): PinConfig {
  if (!raw) return {};
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return {}; }
  const out: PinConfig = {};
  for (const [host, v] of Object.entries(obj as Record<string, unknown>)) {
    const hashes = (v as { publicKeyHashes?: unknown })?.publicKeyHashes;
    if (!/^[a-z0-9.-]+$/i.test(host) || !Array.isArray(hashes)) continue;
    const ok = hashes.filter((h): h is string => typeof h === "string" && /^[A-Za-z0-9+/]{43}=$/.test(h));
    if (ok.length >= 2) out[host] = { includeSubdomains: !!(v as { includeSubdomains?: boolean }).includeSubdomains, publicKeyHashes: ok };
  }
  return out;
}

/** Call once, as early as possible. Pinning applies to every fetch in the app (RPC, backend). */
export async function setupPinning(raw = process.env.EXPO_PUBLIC_PINS) {
  const pins = parsePins(raw);
  const hosts = Object.keys(pins);
  if (hosts.length === 0) { status.state = "off"; status.hosts = []; return status; }
  try {
    if (!isSslPinningAvailable()) { status.state = "error"; status.detail = "Pinning is not available in this build."; return status; }
    await initializeSslPinning(pins);
    addSslPinningErrorListener((e) => { status.violations.push(e.serverHostname); });
    status.state = "on"; status.hosts = hosts;
  } catch (e) {
    status.state = "error"; status.detail = e instanceof Error ? e.message : "Could not start pinning";
  }
  return status;
}
