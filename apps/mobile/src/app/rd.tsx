import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { type Address } from "viem";
import { publicClient } from "@/chain/client";
import { rdAbi } from "@/chain/abis";
import { contracts } from "@/chain/deployments";
import { useChain, type RawPosition } from "@/chain/DataProvider";
import { useTx, type Step } from "@/chain/tx";
import { approvalSteps, DAY, MONTH } from "@/chain/actions";
import { formatAmount, formatDate } from "@/chain/format";
import { projectedRd } from "@/content/deck";
import { useWallet } from "@/wallet/WalletProvider";
import { useNow } from "@/hooks/useNow";
import { radius, space, useColors } from "@/design/tokens";
import { LargeTitleScreen } from "@/ui/LargeTitleScreen";
import { Banner, ProgressBar, Section, Stat } from "@/ui/parts";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { T } from "@/ui/Text";
import { TxSheet } from "@/ui/TxSheet";
import { PlanCard, Segments, SummaryRow } from "@/ui/kit";
import { Icon } from "@/ui/Icon";

type Plan = { id: number; monthly: bigint; months: number; rewardBps: number };
type Detail = { monthly: bigint; months: number; paidCount: number; onTimeCount: number; graceDays: number; latePenaltyBps: number; earlyPenaltyBps: number; earlyAfterDays: number; paid: boolean[]; missed: number };

async function loadDetail(p: RawPosition): Promise<Detail> {
  const vault = contracts.rd!;
  const a = await publicClient.readContract({ address: vault, abi: rdAbi, functionName: "accounts", args: [p.id] });
  const months = Number(a[1]);
  const [paid, missed] = await Promise.all([
    publicClient.multicall({ allowFailure: false, contracts: Array.from({ length: months }, (_, i) => ({ address: vault, abi: rdAbi, functionName: "paid" as const, args: [p.id, i] as const })) }),
    publicClient.readContract({ address: vault, abi: rdAbi, functionName: "missedCount", args: [p.id] }),
  ]);
  return { monthly: a[0], months, paidCount: a[2], onTimeCount: a[3], graceDays: a[5], latePenaltyBps: a[6], earlyPenaltyBps: a[7], earlyAfterDays: Number(a[9]), paid: [...paid], missed: Number(missed) };
}

function Dots({ d, openedAt, now }: { d: Detail; openedAt: number; now: number }) {
  const c = useColors();
  const cur = Math.floor((now - openedAt) / MONTH);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }} accessible accessibilityLabel={`${d.paidCount} of ${d.months} instalments paid`}>
      {d.paid.map((paid, i) => {
        const due = openedAt + i * MONTH, late = now > due + d.graceDays * DAY;
        const bg = paid ? c.emerald : "transparent";
        const border = paid ? c.emerald : i > cur ? c.border : late ? c.error : c.primary;
        return <View key={i} style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: bg, borderWidth: 1.5, borderColor: border }} />;
      })}
    </View>
  );
}

export default function Rd() {
  const router = useRouter();
  const c = useColors();
  const { address } = useWallet();
  const chain = useChain();
  const now = useNow(30_000);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const tx = useTx(() => { chain.refresh(); reload(); });
  const mine = chain.rd.filter((p) => p.status === 1);
  const vault = contracts.rd as Address | undefined;

  const reload = useCallback(async () => {
    if (!contracts.rd) return;
    try {
      const n = Number(await publicClient.readContract({ address: contracts.rd, abi: rdAbi, functionName: "planCount" }));
      const rows = await Promise.all(Array.from({ length: n }, (_, i) => publicClient.readContract({ address: contracts.rd!, abi: rdAbi, functionName: "plans", args: [BigInt(i + 1)] })));
      const list = rows.map((r, i) => ({ id: i + 1, monthly: r[0], months: r[1], rewardBps: r[2], enabled: r[3] })).filter((p) => p.enabled);
      setPlans(list); setSel((s) => s ?? list[0]?.id ?? null);
      const entries = await Promise.all(mine.map(async (p) => [String(p.id), await loadDetail(p)] as const));
      setDetails(Object.fromEntries(entries));
    } catch { /* keep last */ }
  }, [mine.map((p) => String(p.id)).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [reload]);

  const call = (label: string, functionName: string, args: unknown[]): Step => ({ label, address: vault!, abi: rdAbi as never, functionName, args });
  const plan = plans.find((p) => p.id === sel);
  const proj = plan ? projectedRd(Number(plan.monthly / 10n ** 18n), plan.months / 12) : undefined;

  const start = async () => {
    if (!plan) return;
    const approve = await approvalSteps(address!, vault!, plan.monthly);
    tx.run("Start monthly plan", [...approve, call("Start plan & pay first instalment", "open", [BigInt(plan.id)])], { amount: formatAmount(plan.monthly), rows: [{ label: "Plan", value: `${plan.months} months` }, { label: "First instalment", value: "Paid now" }] });
  };
  const payNext = async (p: RawPosition, d: Detail) => {
    const idx = d.paid.findIndex((x, i) => !x && i <= Math.floor((now - Number(p.openedAt)) / MONTH));
    if (idx < 0) return;
    const late = now > Number(p.openedAt) + idx * MONTH + d.graceDays * DAY;
    const amount = d.monthly + (late ? (d.monthly * BigInt(d.latePenaltyBps)) / 10000n : 0n);
    const approve = await approvalSteps(address!, vault!, amount);
    tx.run(`Instalment ${idx + 1}`, [...approve, call("Pay instalment", "pay", [p.id, idx])], { amount: formatAmount(amount), rows: [{ label: "Account", value: `Monthly plan #${p.id}` }, ...(late ? [{ label: "Includes late fee", value: "Yes" }] : [])] });
  };

  return (
    <LargeTitleScreen title="Monthly plan" subtitle="The same amount, every month" back>
      <Section index={0}>
        {!vault ? <Banner kind="warning" title="Coming soon" body="This feature is being switched on. Please check back shortly." /> : !chain.registered && chain.loaded ? <Banner title="Join JanSetu first" body="It takes one quick step on the Home screen." action={{ label: "Go to Home", onPress: () => router.navigate("/") }} /> : null}
      </Section>

      {plans.length > 0 && (
        <Section title="Start a plan" index={1}>
          {plans.map((p) => {
            const on = p.id === sel;
            const pr = projectedRd(Number(p.monthly / 10n ** 18n), p.months / 12);
            return (
              <Pressable key={p.id} onPress={() => setSel(p.id)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                <Card style={{ gap: 6, borderColor: on ? c.primary : c.border, borderWidth: on ? 2 : 1, backgroundColor: on ? c.tint : c.surface }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}><View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: on ? c.primary : c.border, alignItems: "center", justifyContent: "center" }}>{on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.primary }} /> : null}</View><View style={{ flex: 1 }}><T v="headline" style={{ fontFamily: "Lora_600SemiBold", fontSize: 18 }}>{`${formatAmount(p.monthly, 0)} tINR a month · ${p.months / 12} ${p.months === 12 ? "year" : "years"}`}</T></View></View>
                  {pr ? <T v="footnote" color="textSecondary">Estimate: {formatAmount(BigInt(pr.deposited) * 10n ** 18n, 0)} paid in → {formatAmount(BigInt(pr.projected) * 10n ** 18n, 0)} at {pr.apy}% APY. Not guaranteed.</T> : null}
                </Card>
              </Pressable>
            );
          })}
          <T v="footnote" color="textSecondary" style={{ marginLeft: 4 }}>The first instalment is paid when you start. Late instalments may carry a small fee after a grace period. Rewards and the on-time loyalty bonus are paid only if the reward pool is funded.</T>
          {proj ? <Chip kind="projected" label="Estimates only" /> : null}
          <Button label="Start this plan" onPress={start} disabled={!vault || !chain.registered || !plan} />
        </Section>
      )}

      <Section title="Your plans" index={2}>
        {mine.length === 0 ? <Card><T v="body" color="textSecondary">No active monthly plans yet.</T></Card> : mine.map((p) => {
          const d = details[String(p.id)];
          const matured = now >= Number(p.maturityAt);
          const earlyOpen = !!d && now >= Number(p.openedAt) + d.earlyAfterDays * DAY && !matured;
          const cur = Math.floor((now - Number(p.openedAt)) / MONTH);
          const payable = !!d && d.paid.some((x, i) => !x && i <= cur) && !matured;
          return (
            <View key={String(p.id)} style={{ gap: space.md }}>
              <PlanCard tone="green">
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1 }}>
                    <T v="footnote" style={{ color: "#fff", opacity: 0.85 }}>{d ? "Every month" : "Monthly plan"} · #{String(p.id)}</T>
                    <T v="money" style={{ color: "#fff", fontSize: 32, lineHeight: 40 }}>{d ? formatAmount(d.monthly, 0) : "…"} <T v="callout" style={{ color: "#fff" }}>tINR</T></T>
                  </View>
                  {d ? <View style={{ alignItems: "flex-end" }}><T v="money" style={{ color: "#fff", fontSize: 28, lineHeight: 36 }}>{d.paidCount}<T v="callout" style={{ color: "#fff", opacity: 0.8 }}> / {d.months}</T></T><T v="caption" style={{ color: "#fff", opacity: 0.85 }}>paid</T></View> : null}
                </View>
                {d ? <View style={{ marginTop: 16 }}><Segments total={d.months} done={d.paidCount} color="#FFFFFF" track="rgba(255,255,255,0.28)" /></View> : null}
                {d ? <T v="footnote" style={{ color: "#fff", opacity: 0.9, marginTop: 10 }}>{d.onTimeCount} on time{d.missed > 0 ? ` · ${d.missed} missed` : ""} · matures {formatDate(p.maturityAt)}</T> : null}
              </PlanCard>
              <Card style={{ paddingVertical: space.xs }}>
                <SummaryRow label="Your deposit" value={formatAmount(p.principal)} />
                <SummaryRow label="Reward set aside" value={p.rewardUnfunded > 0n ? `${formatAmount(p.rewardReserved)} (part not covered)` : formatAmount(p.rewardReserved)} last={!(p.locked > 0n) && !(d && d.paidCount === d.months && d.onTimeCount === d.months)} />
                {d && d.paidCount === d.months && d.onTimeCount === d.months ? <SummaryRow label="Loyalty bonus" value="Eligible" last={!(p.locked > 0n)} /> : null}
                {p.locked > 0n ? <SummaryRow label="Pledged for a loan" value={formatAmount(p.locked)} last /> : null}
              </Card>
              {d && payable ? <Button label="Pay this instalment" onPress={() => payNext(p, d)} /> : null}
              {matured ? <Button label="Claim at maturity" onPress={() => tx.run("Claim monthly plan", [call("Claim", "claim", [p.id])])} /> : null}
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
