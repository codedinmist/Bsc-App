import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { type Address } from "viem";
import { publicClient } from "@/chain/client";
import { dailyAbi } from "@/chain/abis";
import { contracts } from "@/chain/deployments";
import { useChain, type RawPosition } from "@/chain/DataProvider";
import { useTx, type Step } from "@/chain/tx";
import { approvalSteps, DAY } from "@/chain/actions";
import { E, formatAmount, formatDate } from "@/chain/format";
import { projectedDaily } from "@/content/deck";
import { useWallet } from "@/wallet/WalletProvider";
import { useNow } from "@/hooks/useNow";
import { space } from "@/design/tokens";
import { LargeTitleScreen } from "@/ui/LargeTitleScreen";
import { Banner, ProgressBar, Section, Segmented, Stat } from "@/ui/parts";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { T } from "@/ui/Text";
import { TxSheet } from "@/ui/TxSheet";
import { PillRow, PlanCard, Segments, SummaryRow } from "@/ui/kit";

type Detail = { installment: bigint; totalDays: number; paidCount: number; earlyAfterDays: number; earlyPenaltyBps: number; firstUnpaid: number | null; missed: number };
const TIERS = [50, 100, 200, 500] as const;

async function loadDetail(p: RawPosition, now: number): Promise<Detail> {
  const vault = contracts.daily!;
  const a = await publicClient.readContract({ address: vault, abi: dailyAbi, functionName: "accounts", args: [p.id] });
  const today = Math.min(Number(a[1]) - 1, Math.floor((now - Number(p.openedAt)) / DAY));
  const paid = today >= 0 && now < Number(p.maturityAt)
    ? await publicClient.multicall({ allowFailure: false, contracts: Array.from({ length: today + 1 }, (_, i) => ({ address: vault, abi: dailyAbi, functionName: "paid" as const, args: [p.id, i] as const })) })
    : [];
  const firstUnpaid = paid.findIndex((x) => !x);
  return { installment: a[0], totalDays: a[1], paidCount: a[2], earlyAfterDays: a[3], earlyPenaltyBps: a[4], firstUnpaid: firstUnpaid >= 0 ? firstUnpaid : null, missed: paid.filter((x) => !x).length - (paid[today] === false ? 1 : 0) };
}

export default function Daily() {
  const router = useRouter();
  const { address } = useWallet();
  const chain = useChain();
  const now = useNow(30_000);
  const [tier, setTier] = useState<(typeof TIERS)[number]>(100);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [pool, setPool] = useState<bigint | null>(null);
  const tx = useTx(() => { chain.refresh(); reload(); });
  const mine = chain.daily.filter((p) => p.status === 1);

  const reload = useCallback(async () => {
    try {
      setPool(await publicClient.readContract({ address: contracts.daily!, abi: dailyAbi, functionName: "rewardPool" }));
      const entries = await Promise.all(mine.map(async (p) => [String(p.id), await loadDetail(p, Math.floor(Date.now() / 1000))] as const));
      setDetails(Object.fromEntries(entries));
    } catch { /* keep last */ }
  }, [mine.map((p) => String(p.id)).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (contracts.daily) reload(); }, [reload]);

  const vault = contracts.daily as Address | undefined;
  const call = (label: string, functionName: string, args: unknown[]): Step => ({ label, address: vault!, abi: dailyAbi as never, functionName, args });

  const open = async () => {
    const amt = E(tier);
    tx.run("Open daily saving account", [call("Open your account", "open", [amt])], { amount: formatAmount(amt), rows: [{ label: "Daily deposit", value: `${formatAmount(amt)} tINR a day` }, { label: "Plan", value: "J-Daily savings" }] });
  };
  const deposit = async (p: RawPosition, d: Detail, day: number) => {
    const approve = await approvalSteps(address!, vault!, d.installment);
    tx.run("Daily deposit", [...approve, call("Deposit", "deposit", [p.id, day])], { amount: formatAmount(d.installment), rows: [{ label: "Account", value: `J-Daily #${p.id}` }, { label: "Day", value: String(day + 1) }] });
  };

  const proj = projectedDaily(tier);
  const notReady = !vault || !chain.registered;

  return (
    <LargeTitleScreen title="Daily saving" subtitle="A little, every day" back>
      <Section index={0}>
        {!vault ? <Banner kind="warning" title="Coming soon" body="This feature is being switched on. Please check back shortly." /> : !chain.registered && chain.loaded ? <Banner title="Join JanSetu first" body="It takes one quick step on the Home screen." action={{ label: "Go to Home", onPress: () => router.navigate("/") }} /> : null}
      </Section>

      <Section title="Start saving daily" index={1}>
        <PillRow options={TIERS.map((t) => ({ label: `${t.toLocaleString("en-IN")} a day`, value: t }))} value={tier} onChange={setTier} />
        {proj ? (
          <PlanCard tone="emerald">
            <T v="caption" style={{ color: "#BFD3C6", letterSpacing: 1.3, textTransform: "uppercase" }}>After 12 months</T>
            <T v="money" style={{ color: "#fff", fontSize: 36, lineHeight: 44 }}>{formatAmount(E(proj.projected), 0)} <T v="callout" style={{ color: "#fff" }}>tINR</T></T>
            <T v="footnote" style={{ color: "#fff", opacity: 0.85 }}>You put in {formatAmount(E(proj.deposited), 0)}. An estimate, not a promise.</T>
          </PlanCard>
        ) : null}
        <T v="footnote" color="textSecondary">You can pay any day you missed. Take your money out after 30 days if you need to, but the reward is given up then.{pool !== null ? ` The reward pool holds ${formatAmount(pool, 0)} tINR today.` : ""}</T>
        <Button label="Open account" onPress={open} disabled={notReady} />
      </Section>

      <Section title="Your accounts" index={2}>
        {mine.length === 0 ? <Card><T v="body" color="textSecondary">No active daily accounts yet.</T></Card> : mine.map((p) => {
          const d = details[String(p.id)];
          const matured = now >= Number(p.maturityAt);
          const earlyOpen = !!d && now >= Number(p.openedAt) + d.earlyAfterDays * DAY && !matured;
          const todayIdx = Math.floor((now - Number(p.openedAt)) / DAY);
          const todayPaid = !!d && d.firstUnpaid === null;
          return (
            <View key={String(p.id)} style={{ gap: space.md }}>
              <PlanCard tone="emerald">
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1 }}>
                    <T v="footnote" style={{ color: "#fff", opacity: 0.85 }}>Every day · #{String(p.id)}</T>
                    <T v="money" style={{ color: "#fff", fontSize: 32, lineHeight: 40 }}>{d ? formatAmount(d.installment, 0) : "…"} <T v="callout" style={{ color: "#fff" }}>tINR</T></T>
                  </View>
                  {d ? <View style={{ alignItems: "flex-end" }}><T v="money" style={{ color: "#fff", fontSize: 28, lineHeight: 36 }}>{d.paidCount}<T v="callout" style={{ color: "#fff", opacity: 0.8 }}> / {d.totalDays}</T></T><T v="caption" style={{ color: "#fff", opacity: 0.85 }}>days paid</T></View> : null}
                </View>
                {d ? <View style={{ marginTop: 16 }}><Segments total={Math.min(d.totalDays, 30)} done={Math.round((d.paidCount / d.totalDays) * Math.min(d.totalDays, 30))} color="#FFFFFF" track="rgba(255,255,255,0.25)" /></View> : null}
                {d ? <T v="footnote" style={{ color: "#fff", opacity: 0.9, marginTop: 10 }}>{d.missed > 0 ? `${d.missed} missed, you can still pay them · ` : ""}Matures {formatDate(p.maturityAt)}</T> : null}
              </PlanCard>
              <Card style={{ paddingVertical: space.xs }}>
                <SummaryRow label="Your deposit" value={formatAmount(p.principal)} />
                <SummaryRow label="Reward set aside" value={p.rewardUnfunded > 0n ? `${formatAmount(p.rewardReserved)} (part not covered)` : formatAmount(p.rewardReserved)} last={!(p.locked > 0n)} />
                {p.locked > 0n ? <SummaryRow label="Pledged for a loan" value={formatAmount(p.locked)} last /> : null}
              </Card>
              {d && !matured ? (
                <Button label={d.firstUnpaid !== null ? (d.firstUnpaid === todayIdx ? "Deposit for today" : `Pay missed day ${d.firstUnpaid + 1}`) : "Today is paid ✓"} disabled={todayPaid} onPress={() => deposit(p, d, d.firstUnpaid!)} />
              ) : null}
              {matured ? <Button label="Claim at maturity" onPress={() => tx.run("Claim daily saving", [call("Claim", "claim", [p.id])])} /> : null}
              {earlyOpen && d ? <Button label={`Withdraw early${d.earlyPenaltyBps ? ` · ${d.earlyPenaltyBps / 100}% fee` : ""}`} variant="secondary" onPress={() => tx.run("Withdraw early", [call("Withdraw", "withdrawEarly", [p.id])])} /> : null}
              {d && !earlyOpen && !matured ? <T v="footnote" color="textSecondary" style={{ textAlign: "center" }}>Early withdrawal opens after {d.earlyAfterDays} days.</T> : null}
            </View>
          );
        })}
      </Section>
      <TxSheet state={tx.state} onClose={tx.reset} />
    </LargeTitleScreen>
  );
}
