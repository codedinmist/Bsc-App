import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, Switch, View } from "react-native";
import { type Address } from "viem";
import { publicClient } from "@/chain/client";
import { fdAbi } from "@/chain/abis";
import { contracts } from "@/chain/deployments";
import { useChain, type RawPosition } from "@/chain/DataProvider";
import { useTx, type Step } from "@/chain/tx";
import { approvalSteps } from "@/chain/actions";
import { formatAmount, formatDate, parseAmount } from "@/chain/format";
import { DECK_FD_RATES, projectedFd } from "@/content/deck";
import { useWallet } from "@/wallet/WalletProvider";
import { useNow } from "@/hooks/useNow";
import { space, useColors } from "@/design/tokens";
import { LargeTitleScreen } from "@/ui/LargeTitleScreen";
import { AmountInput, Banner, Section, Segmented, Stat } from "@/ui/parts";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { T } from "@/ui/Text";
import { TxSheet } from "@/ui/TxSheet";
import { HeroAmountInput, PillRow, PlanCard, Ring, SummaryRow } from "@/ui/kit";
import { Icon } from "@/ui/Icon";

type Term = { id: number; days: number; rewardBps: number };
type Dep = { earlyPenaltyBps: number; earlyAllowed: boolean };

export default function Fd() {
  const router = useRouter();
  const c = useColors();
  const { address } = useWallet();
  const chain = useChain();
  const now = useNow(30_000);
  const [terms, setTerms] = useState<Term[]>([]);
  const [termId, setTermId] = useState<number | null>(null);
  const [amountText, setAmountText] = useState("25000");
  const [needFunded, setNeedFunded] = useState(true);
  const [pool, setPool] = useState<bigint>(0n);
  const [deps, setDeps] = useState<Record<string, Dep>>({});
  const tx = useTx(() => { chain.refresh(); reload(); });
  const mine = chain.fd.filter((p) => p.status === 1);
  const vault = contracts.fd as Address | undefined;

  const reload = useCallback(async () => {
    if (!contracts.fd) return;
    try {
      const n = Number(await publicClient.readContract({ address: contracts.fd, abi: fdAbi, functionName: "termCount" }));
      const rows = await Promise.all(Array.from({ length: n }, (_, i) => publicClient.readContract({ address: contracts.fd!, abi: fdAbi, functionName: "terms", args: [BigInt(i + 1)] })));
      const list = rows.map((r, i) => ({ id: i + 1, days: Number(r[0]), rewardBps: r[1], enabled: r[2] })).filter((t) => t.enabled);
      setTerms(list); setTermId((s) => s ?? list[0]?.id ?? null);
      setPool(await publicClient.readContract({ address: contracts.fd, abi: fdAbi, functionName: "rewardPool" }));
      const entries = await Promise.all(mine.map(async (p) => { const d = await publicClient.readContract({ address: contracts.fd!, abi: fdAbi, functionName: "deposits", args: [p.id] }); return [String(p.id), { earlyPenaltyBps: d[1], earlyAllowed: d[2] }] as const; }));
      setDeps(Object.fromEntries(entries));
    } catch { /* keep last */ }
  }, [mine.map((p) => String(p.id)).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [reload]);

  const term = terms.find((t) => t.id === termId);
  const amount = parseAmount(amountText);
  const years = term ? Math.round(term.days / 365) : 1;
  const rewardNeeded = term && amount ? (amount * BigInt(term.rewardBps)) / 10000n : 0n;
  const funded = pool >= rewardNeeded;
  const projected = useMemo(() => {
    if (!amount || !term) return null;
    const amt = Number(amount / 10n ** 18n);
    const deck = years >= 1 && years <= 3 ? projectedFd(amt, years as 1 | 2 | 3) : undefined;
    return deck ?? Math.round(amt * (1 + term.rewardBps / 10000));
  }, [amount, term, years]);

  const call = (label: string, functionName: string, args: unknown[]): Step => ({ label, address: vault!, abi: fdAbi as never, functionName, args });
  const open = async () => {
    if (!amount || !term) return;
    const approve = await approvalSteps(address!, vault!, amount);
    tx.run("Open fixed deposit", [...approve, call("Lock your deposit", "open", [BigInt(term.id), amount, needFunded])], { amount: formatAmount(amount), rows: [{ label: "Term", value: `${years} year${years > 1 ? "s" : ""}` }, { label: "Withdrawal", value: "At maturity (early exit has a penalty)" }] });
  };
  const ready = !!vault && chain.registered && !!amount && !!term;

  return (
    <LargeTitleScreen title="Fixed deposit" subtitle="Lock once, collect at maturity" back>
      <Section index={0}>
        {!vault ? <Banner kind="warning" title="Coming soon" body="This feature is being switched on. Please check back shortly." /> : !chain.registered && chain.loaded ? <Banner title="Join JanSetu first" body="It takes one quick step on the Home screen." action={{ label: "Go to Home", onPress: () => router.navigate("/") }} /> : null}
      </Section>

      {terms.length > 0 && (
        <>
          <Section title="How long" index={1}>
            <PillRow options={terms.map((t) => ({ label: `${Math.round(t.days / 365)} ${Math.round(t.days / 365) === 1 ? "year" : "years"}`, value: t.id }))} value={termId ?? terms[0].id} onChange={setTermId} />
          </Section>
          <Section title="Amount" index={2}>
            <HeroAmountInput value={amountText} onChangeText={setAmountText} quick={[10000, 50000, 100000, 500000]} />
            {amountText && !amount ? <T v="footnote" color="error">Enter a valid amount.</T> : null}
          </Section>
          <Section index={3}>
            <PlanCard tone="gold">
              <T v="caption" style={{ color: "#5A3F10", letterSpacing: 1.3, textTransform: "uppercase" }}>Estimated reward</T>
              <T v="money" style={{ color: "#2C1C05", fontSize: 36, lineHeight: 44 }}>{projected ? formatAmount(BigInt(projected) * 10n ** 18n - (amount ?? 0n), 0) : "0"} <T v="callout" style={{ color: "#2C1C05" }}>tINR</T></T>
              <T v="footnote" style={{ color: "#2C1C05", opacity: 0.85 }}>If paid in full after {years} {years === 1 ? "year" : "years"} · about {DECK_FD_RATES[years as 1 | 2 | 3] ?? ""} a year. An estimate, not a promise.</T>
            </PlanCard>
            <View style={{ flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: funded ? c.tint : c.warningTint, borderRadius: 20, padding: space.lg }}>
              <Icon name={funded ? "shield" : "alert"} size={22} color={funded ? c.tintText : c.warning} />
              <View style={{ flex: 1 }}>
                <T v="callout" style={{ color: funded ? c.tintText : c.warning, fontFamily: "Inter_600SemiBold" }}>{funded ? "Reward is fully funded today" : "Reward is not fully funded today"}</T>
                <T v="footnote" style={{ color: funded ? c.tintText : c.warning }}>{funded ? "The pool already holds what this deposit needs." : `The pool holds ${formatAmount(pool, 0)} tINR and this deposit needs ${formatAmount(rewardNeeded, 0)}. Your deposit still comes back in full.`}</T>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <View style={{ flex: 1 }}><T v="callout">Only open if the reward is fully funded</T></View>
              <Switch value={needFunded} onValueChange={setNeedFunded} trackColor={{ true: c.primary, false: c.border }} />
            </View>
            <Button label="Lock deposit" onPress={open} disabled={!ready || (needFunded && !funded)} />
          </Section>
        </>
      )}

      <Section title="Your fixed deposits" index={2}>
        {mine.length === 0 ? <Card><T v="body" color="textSecondary">No active fixed deposits yet.</T></Card> : mine.map((p: RawPosition) => {
          const dep = deps[String(p.id)];
          const matured = now >= Number(p.maturityAt);
          return (
            <View key={String(p.id)} style={{ gap: space.md }}>
              <PlanCard tone="gold">
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <T v="footnote" style={{ color: "#2C1C05", opacity: 0.8 }}>Locked · #{String(p.id)}</T>
                    <T v="money" style={{ color: "#2C1C05", fontSize: 32, lineHeight: 40 }}>{formatAmount(p.principal)} <T v="callout" style={{ color: "#2C1C05" }}>tINR</T></T>
                  </View>
                  <Ring frac={Math.max(0, Math.min(1, (now - Number(p.openedAt)) / Math.max(1, Number(p.maturityAt) - Number(p.openedAt))))} size={78} color="#2C1C05" track="rgba(44,28,5,0.18)">
                    <T v="headline" style={{ color: "#2C1C05", fontFamily: "Lora_600SemiBold" }}>{matured ? "Ready" : `${Math.max(1, Math.ceil((Number(p.maturityAt) - now) / 2_592_000))}`}</T>
                    {matured ? null : <T v="caption" style={{ color: "#2C1C05", fontSize: 10 }}>months</T>}
                  </Ring>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 14 }}>
                  <T v="footnote" style={{ color: "#2C1C05" }}>Opened {formatDate(p.openedAt)}</T>
                  <T v="footnote" style={{ color: "#2C1C05", fontFamily: "Inter_700Bold" }}>Ready {formatDate(p.maturityAt)}</T>
                </View>
              </PlanCard>
              <Card style={{ paddingVertical: space.xs, gap: 0 }}>
                <SummaryRow label="Reward set aside" value={formatAmount(p.rewardReserved)} />
                <SummaryRow label="Reward status" value={p.rewardUnfunded > 0n ? "Not covered" : "Fully funded"} last={p.locked === 0n} />
                {p.locked > 0n ? <SummaryRow label="Pledged for a loan" value={formatAmount(p.locked)} last /> : null}
              </Card>
              {matured ? <Button label="Claim at maturity" onPress={() => tx.run("Claim fixed deposit", [call("Claim", "claim", [p.id])])} /> : <Button label="Claim at maturity" disabled onPress={() => {}} />}
              {!matured && dep?.earlyAllowed ? <Button label={`Withdraw early · ${dep.earlyPenaltyBps / 100}% fee, reward forfeited`} variant="secondary" onPress={() => tx.run("Withdraw early", [call("Withdraw", "withdrawEarly", [p.id])])} /> : null}
              {!matured && dep && !dep.earlyAllowed ? <T v="footnote" color="textSecondary" style={{ textAlign: "center" }}>Early withdrawal is turned off for this deposit.</T> : null}
              {!matured ? <T v="footnote" color="textSecondary" style={{ textAlign: "center" }}>Claiming opens on the ready date.</T> : null}
            </View>
          );
        })}
      </Section>
      <TxSheet state={tx.state} onClose={tx.reset} />
    </LargeTitleScreen>
  );
}
