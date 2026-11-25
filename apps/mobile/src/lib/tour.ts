import { useEffect } from "react";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";

const KEY = "jansetu.tour.seen";

export async function markTourSeen() { try { await SecureStore.setItemAsync(KEY, "1"); } catch { /* non-critical */ } }

/** Opens the intro tour once, the first time the home screen appears. */
export function useFirstRunTour() {
  const router = useRouter();
  useEffect(() => {
    let live = true;
    (async () => {
      try { if (!(await SecureStore.getItemAsync(KEY)) && live) router.push("/tour"); } catch { /* ignore */ }
    })();
    return () => { live = false; };
  }, [router]);
}

const READ = "jansetu.help.read";
export async function getRead(): Promise<string[]> {
  try { return JSON.parse((await SecureStore.getItemAsync(READ)) ?? "[]"); } catch { return []; }
}
export async function markRead(id: string) {
  try { const r = await getRead(); if (!r.includes(id)) await SecureStore.setItemAsync(READ, JSON.stringify([...r, id])); } catch { /* ignore */ }
}
