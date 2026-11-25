import { useCallback, useRef, useState } from "react";
import { createWalletClient, http, type Abi, type Address, type Hash } from "viem";
import { chain, RPC_URL } from "./config";
import { publicClient } from "./client";
import { assertAllowedTarget } from "./deployments";
import { friendlyError } from "./errors";
import { readAddress, withSigner } from "@/wallet/keystore";
import { relayEnabled, sendViaRelay } from "./relay";

export type Step = { label: string; address: Address; abi: Abi; functionName: string; args?: readonly unknown[] };
export type TxPhase = "idle" | "review" | "authenticating" | "simulating" | "sending" | "confirming" | "success" | "failed";
export type TxDetails = { amount?: string; unit?: string; rows?: { label: string; value: string }[] };
export type TxState = { phase: TxPhase; title: string; step: number; steps: number; stepLabel: string; hash?: Hash; error?: string; details?: TxDetails; rows?: { label: string; value: string }[] };

const idle: TxState = { phase: "idle", title: "", step: 0, steps: 0, stepLabel: "" };

// The review sheet (Apple-Pay style) waits for the person. One sheet is on screen at a time, so one pending decision is enough.
let decide: ((ok: boolean) => void) | null = null;
export const confirmPending = () => { decide?.(true); decide = null; };
export const cancelPending = () => { decide?.(false); decide = null; };

/**
 * Runs one or more contract calls. Rules:
 *  - only known JanSetu contracts can be called (pinned list)
 *  - every call is simulated first, so a call that would revert is never sent
 *  - "success" is reported ONLY after the on-chain receipt says status = success
 */
export function useTx(onSettled?: () => void) {
  const [state, setState] = useState<TxState>(idle);
  const busy = useRef(false);

  const run = useCallback(async (title: string, steps: Step[], details?: TxDetails) => {
    if (busy.current) return false;
    busy.current = true;
    const base = { title, steps: steps.length, details };
    try {
      steps.forEach((s) => assertAllowedTarget(s.address));
      // 1) Review: show exactly what is about to happen and wait for a clear "confirm".
      const [sponsored, from] = await Promise.all([relayEnabled().catch(() => false), readAddress().catch(() => null)]);
      const rows = [
        ...(details?.rows ?? []),
        ...(steps.length > 1 ? [{ label: "Steps", value: steps.map((s) => s.label).join(" · ") }] : []),
        { label: "Network", value: "BNB Smart Chain · preview" },
        { label: "Network fee", value: sponsored ? "Free · paid by JanSetu" : "Paid in BNB" },
        ...(from ? [{ label: "From wallet", value: `${from.slice(0, 6)}…${from.slice(-4)}` }] : []),
      ];
      setState({ ...base, phase: "review", step: 0, stepLabel: "", rows });
      const ok = await new Promise<boolean>((resolve) => { decide = resolve; });
      if (!ok) { setState(idle); return false; }
      setState({ ...base, phase: "authenticating", step: 1, stepLabel: steps[0]?.label ?? "", rows });
      let last: Hash | undefined;
      await withSigner(`Confirm: ${title}`, async (account) => {
        const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });
        for (let i = 0; i < steps.length; i++) {
          const s = steps[i];
          setState({ ...base, phase: "simulating", step: i + 1, stepLabel: s.label, rows });
          const { request } = await publicClient.simulateContract({ account, address: s.address, abi: s.abi, functionName: s.functionName, args: s.args } as never);
          setState({ ...base, phase: "sending", step: i + 1, stepLabel: s.label, rows });
          // Free-transaction path first (the backend pays the network fee); otherwise the user pays their own.
          const hash = (await sendViaRelay(account, s.address, s.abi, s.functionName, s.args)) ?? (await wallet.writeContract(request as never));
          last = hash;
          setState({ ...base, phase: "confirming", step: i + 1, stepLabel: s.label, hash, rows });
          const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
          if (receipt.status !== "success") throw new Error("The transaction was reverted on-chain.");
        }
      });
      setState({ ...base, phase: "success", step: steps.length, stepLabel: "", hash: last, rows });
      return true;
    } catch (e) {
      setState((s) => ({ ...base, phase: "failed", step: s.step, stepLabel: s.stepLabel, hash: s.hash, error: friendlyError(e), rows: s.rows }));
      return false;
    } finally {
      busy.current = false;
      onSettled?.();
    }
  }, [onSettled]);

  const reset = useCallback(() => setState(idle), []);
  return { state, run, reset };
}
