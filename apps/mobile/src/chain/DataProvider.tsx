import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { erc20Abi, dailyAbi, rdAbi, fdAbi, registryAbi, microAbi } from "./abis";
import { publicClient } from "./client";
import { contracts, isDeployed } from "./deployments";
import { useWallet } from "@/wallet/WalletProvider";
import type { Address } from "viem";

export type RawPosition = {
  id: bigint; owner: Address; principal: bigint; locked: bigint; rewardReserved: bigint; rewardUnfunded: bigint;
  openedAt: bigint; maturityAt: bigint; collateralEligible: boolean; status: number; // 0 none, 1 active, 2 closed
};
export type ChainData = {
  loaded: boolean; error?: string; bnb: bigint; tinr: bigint; registered: boolean; kyc: boolean; kycRequired: boolean;
  daily: RawPosition[]; rd: RawPosition[]; fd: RawPosition[];
};
const empty: ChainData = { loaded: false, bnb: 0n, tinr: 0n, registered: false, kyc: false, kycRequired: false, daily: [], rd: [], fd: [] };

type Ctx = ChainData & { refresh: () => Promise<void> };
const DataCtx = createContext<Ctx | null>(null);

async function positionsOf(vault: Address, abi: typeof dailyAbi | typeof rdAbi | typeof fdAbi, owner: Address): Promise<RawPosition[]> {
  const ids = (await publicClient.readContract({ address: vault, abi, functionName: "idsOf", args: [owner] } as never)) as bigint[];
  if (!ids.length) return [];
  const rows = await publicClient.multicall({
    allowFailure: false,
    contracts: ids.map((id) => ({ address: vault, abi, functionName: "getPosition", args: [id] })),
  } as never) as unknown as Omit<RawPosition, "id">[];
  return rows.map((r, i) => ({ ...r, id: ids[i] }));
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { address } = useWallet();
  const [data, setData] = useState<ChainData>(empty);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (!address) { setData(empty); return; }
    try {
      const bnb = await publicClient.getBalance({ address });
      if (!isDeployed) { if (alive.current) setData({ ...empty, loaded: true, bnb }); return; }
      const [tinr, registered, kyc, kycRequired, daily, rd, fd] = await Promise.all([
        publicClient.readContract({ address: contracts.token!, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
        publicClient.readContract({ address: contracts.registry!, abi: registryAbi, functionName: "isRegistered", args: [address] }),
        publicClient.readContract({ address: contracts.registry!, abi: registryAbi, functionName: "isKyc", args: [address] }),
        contracts.micro ? publicClient.readContract({ address: contracts.micro, abi: microAbi, functionName: "requireKyc" }).catch(() => false) : Promise.resolve(false),
        positionsOf(contracts.daily!, dailyAbi, address),
        positionsOf(contracts.rd!, rdAbi, address),
        positionsOf(contracts.fd!, fdAbi, address),
      ]);
      if (alive.current) setData({ loaded: true, bnb, tinr, registered, kyc, kycRequired, daily, rd, fd });
    } catch {
      if (alive.current) setData((d) => ({ ...d, loaded: true, error: "Can't reach the network right now. Showing your last known balances." }));
    }
  }, [address]);

  useEffect(() => {
    alive.current = true;
    refresh();
    const t = setInterval(() => { if (AppState.currentState === "active") refresh(); }, 15_000);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") refresh(); });
    return () => { alive.current = false; clearInterval(t); sub.remove(); };
  }, [refresh]);

  const value = useMemo(() => ({ ...data, refresh }), [data, refresh]);
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export function useChain() {
  const v = useContext(DataCtx);
  if (!v) throw new Error("useChain outside DataProvider");
  return v;
}
