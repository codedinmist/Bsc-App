import { useCallback, useEffect, useRef, useState } from "react";

/** Runs an async loader, keeps the last good value and exposes reload(). Errors never crash a screen. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[], initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const loader = useRef(load); loader.current = load;
  const reload = useCallback(async () => {
    try { const v = await loader.current(); if (alive.current) { setValue(v); setError(null); } }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Could not load"); }
    finally { if (alive.current) setLoading(false); }
  }, []);
  useEffect(() => { alive.current = true; reload(); return () => { alive.current = false; }; }, [reload, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { value, loading, error, reload };
}
