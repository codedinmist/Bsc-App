import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createWallet, importWallet, readAddress, removeWallet } from "./keystore";

type Status = "loading" | "none" | "ready";
type Ctx = {
  status: Status; address: `0x${string}` | null;
  create: () => Promise<string>; restore: (phrase: string) => Promise<void>; remove: () => Promise<void>;
};
const WalletCtx = createContext<Ctx | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [address, setAddress] = useState<`0x${string}` | null>(null);

  useEffect(() => { readAddress().then((a) => { setAddress(a); setStatus(a ? "ready" : "none"); }).catch(() => setStatus("none")); }, []);

  const create = useCallback(async () => {
    const { mnemonic, address: a } = await createWallet();
    setAddress(a); setStatus("ready");
    return mnemonic;
  }, []);
  const restore = useCallback(async (phrase: string) => { const a = await importWallet(phrase); setAddress(a); setStatus("ready"); }, []);
  const remove = useCallback(async () => { await removeWallet(); setAddress(null); setStatus("none"); }, []);

  const value = useMemo(() => ({ status, address, create, restore, remove }), [status, address, create, restore, remove]);
  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}

export function useWallet() {
  const v = useContext(WalletCtx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}
