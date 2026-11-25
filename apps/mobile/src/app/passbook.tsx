import { useMemo, useState } from "react";
import { Pressable, Share, View } from "react-native";
import { publicClient } from "@/chain/client";
import { getLogsAll } from "@/lib/logs";
import { receiptsAbi, transferEvent } from "@/chain/abis";
import { contracts } from "@/chain/deployments";
import { formatAmount } from "@/chain/format";
import { useWallet } from "@/wallet/WalletProvider";
import { useAsync } from "@/hooks/useAsync";
import { space, useColors } from "@/design/tokens";
import { LargeTitleScreen } from "@/ui/LargeTitleScreen";
import { Banner, Section } from "@/ui/parts";
import { Card } from "@/ui/Card";
import { Icon, type IconName } from "@/ui/Icon";
import { Sheet } from "@/ui/Sheet";
import { Button } from "@/ui/Button";
import { BigAmount, HeroCard, Pill, SummaryRow } from "@/ui/kit";
import { Skeleton } from "@/ui/Skeleton";
import { T } from "@/ui/Text";

const KINDS = ["Daily saving", "Monthly instalment", "Fixed deposit", "Payment", "Loan repayment", "Loan completed", "Money received"];
const ICONS: IconName[] = ["savings", "clock", "lock", "pay", "credit", "check", "plus"];
const GROUP = ["Savings", "Savings", "Savings", "Payments", "Loans", "Loans", "Money in"] as const;
const FILTERS = ["All", "Money in", "Savings", "Payments", "Loans"] as const;
type Item = { key: string; id?: bigint; kind: number; amount: bigint; at: number };
const dayKey = (sec: number) => new Date(sec * 1000).toDateString();
const dayLabel = (sec: number) => { const d = new Date(sec * 1000), t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1); return d.toDateString() === t.toDateString() ? "Today" : d.toDateString() === y.toDateString() ? "Yesterday" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); };
const clock = (sec: number) => new Date(sec * 1000).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const when = (sec: number) => new Date(sec * 1000).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

/** Digital passbook: every deposit, instalment, payment and repayment is a receipt token issued to your wallet by the chain. Nobody can edit or delete one. */
export default function Passbook() {
  const { address } = useWallet();
  const data = useAsync(async () => {
    if (!address) return [] as Item[];
    const rows: Item[] = [];
    if (contracts.receipts) {
      const ev = receiptsAbi.find((x) => x.type === "event")!;
      const logs = await getLogsAll({ address: contracts.receipts!, event: ev as never, args: { to: address } as never });
      const ids = logs.map((l) => (l as unknown as { args: { receiptId: bigint } }).args.receiptId);
      const uniq = [...new Set(ids)].sort((a, b) => (a < b ? 1 : -1)).slice(0, 200);
      const got = await Promise.all(uniq.map(async (id) => {
        const r = await publicClient.readContract({ address: contracts.receipts!, abi: receiptsAbi, functionName: "receiptOf", args: [id] });
        return { key: `r${id}`, id, kind: Number(r.kind), amount: r.amount, at: Number(r.timestamp) } as Item;
      }));
      rows.push(...got);
    }
    if (contracts.token) {
      const all = (await getLogsAll({ address: contracts.token!, event: transferEvent, args: { to: address } })) as unknown as { blockNumber: bigint; transactionHash: string; logIndex: number; args: { value?: bigint } }[];
      const logs = all.sort((a, b) => (a.blockNumber < b.blockNumber ? 1 : -1)).slice(0, 150);
      const blocks = [...new Set(logs.map((l) => l.blockNumber))];
      const times = new Map<bigint, number>();
      for (let i = 0; i < blocks.length; i += 10) await Promise.all(blocks.slice(i, i + 10).map(async (n) => { try { times.set(n, Number((await publicClient.getBlock({ blockNumber: n })).timestamp)); } catch { /* skip */ } }));
      for (const l of logs) { const at = times.get(l.blockNumber); if (at) rows.push({ key: `t${l.transactionHash}${l.logIndex}`, kind: 6, amount: l.args.value ?? 0n, at }); }
    }
    return rows.sort((a, b) => b.at - a.at);
  }, [address], [] as Item[]);

  const c = useColors();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [open, setOpen] = useState<Item | null>(null);
  const items = data.value;
  const shown = useMemo(() => items.filter((r) => filter === "All" || GROUP[r.kind] === filter), [items, filter]);
  const month = useMemo(() => {
    const n = new Date(); const rows = items.filter((r) => { const d = new Date(r.at * 1000); return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear(); });
    const sum = (f: (r: Item) => boolean) => rows.filter(f).reduce((a, r) => a + r.amount, 0n);
    return { n: rows.length, rows, inn: sum((r) => r.kind === 6), out: sum((r) => r.kind <= 4), label: n.toLocaleDateString("en-IN", { month: "long", year: "numeric" }) };
  }, [items]);
  const groups = useMemo(() => {
    const out: { key: string; label: string; rows: Item[] }[] = [];
    for (const r of shown) { const k = dayKey(r.at); const g = out.find((x) => x.key === k); if (g) g.rows.push(r); else out.push({ key: k, label: dayLabel(r.at), rows: [r] }); }
    return out;
  }, [shown]);
  const tone = (kind: number) => (kind === 6 ? [c.tint, c.success] : kind === 2 ? [c.warningTint, c.warning] : kind === 3 ? [c.errorTint, c.error] : [c.tint, c.tintText]);
  const statement = () => {
    const lines = month.rows.map((r) => `${when(r.at)}  ${KINDS[r.kind] ?? "Receipt"}  ${r.kind === 6 ? "+" : r.kind === 5 ? "" : "-"}${formatAmount(r.amount)} tINR`);
    Share.share({ message: `JanSetu statement, ${month.label}\nMoney in: ${formatAmount(month.inn)} tINR\nMoney out: ${formatAmount(month.out)} tINR\n\n${lines.join("\n") || "No activity this month."}` }).catch(() => {});
  };
  const share = (r: Item) => Share.share({ message: `JanSetu receipt #${String(r.id)}: ${KINDS[r.kind] ?? "Receipt"}, ${formatAmount(r.amount)} tINR on ${when(r.at)}.` }).catch(() => {});

  return (
    <LargeTitleScreen title="Passbook" subtitle="Every receipt, saved on the public record" back>
      <Section index={0}>
        <HeroCard label={month.label} action="Statement ›" onAction={statement}>
          <View style={{ flexDirection: "row", gap: 28, marginTop: 6 }}>
            <View><T v="caption" style={{ color: "#BFD3C6" }}>Money in</T><T v="money" style={{ color: "#8EE0B4", fontSize: 26, lineHeight: 34 }}>+{formatAmount(month.inn, 0)}</T></View>
            <View><T v="caption" style={{ color: "#BFD3C6" }}>Money out</T><T v="money" style={{ color: "#F6F1E4", fontSize: 26, lineHeight: 34 }}>−{formatAmount(month.out, 0)}</T></View>
          </View>
          <T v="footnote" style={{ color: "#BFD3C6", marginTop: 4 }}>{month.n === 0 ? "No activity this month yet" : `${month.n} transaction${month.n === 1 ? "" : "s"} this month`}</T>
        </HeroCard>
      </Section>
      <Section index={1}>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>{FILTERS.map((f) => <Pill key={f} label={f} on={f === filter} onPress={() => setFilter(f)} />)}</View>
      </Section>
      {data.error ? <Section index={2}><Banner kind="warning" title="Could not load receipts" body="Check your connection and pull to try again." /></Section> : null}
      {data.loading && !data.error ? <Skeleton height={90} /> : null}
      {!data.loading && !data.error && groups.length === 0 ? <Section index={2}><Card><T v="body" color="textSecondary">{items.length ? "Nothing here for this filter." : "No receipts yet. Make a deposit and its receipt appears here."}</T></Card></Section> : null}
      {groups.map((g, gi) => (
        <Section key={g.key} title={g.label} index={gi + 2}>
          <Card padded={false} style={{ overflow: "hidden" }}>
            {g.rows.map((r, i) => {
              const [bg, fg] = tone(r.kind);
              return (
                <Pressable key={r.key} onPress={() => setOpen(r)} accessibilityRole="button" accessibilityLabel={`${KINDS[r.kind] ?? "Receipt"}, ${formatAmount(r.amount)} tINR`}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, paddingHorizontal: space.lg, backgroundColor: pressed ? c.surfaceAlt : "transparent", borderBottomWidth: i === g.rows.length - 1 ? 0 : 1, borderBottomColor: c.hairline })}>
                  <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}><Icon name={ICONS[r.kind] ?? "check"} size={20} color={fg} /></View>
                  <View style={{ flex: 1 }}><T v="callout" style={{ fontFamily: "Inter_600SemiBold" }}>{KINDS[r.kind] ?? "Receipt"}</T><T v="footnote" color="textSecondary">{clock(r.at)} · {r.id !== undefined ? ` · #${String(r.id)}` : ""}</T></View>
                  <View style={{ alignItems: "flex-end" }}><T v="headline" style={{ fontFamily: "Lora_600SemiBold", fontVariant: ["tabular-nums"], color: r.kind === 6 ? c.success : c.text }}>{r.kind === 6 ? "+" : r.kind === 5 ? "" : "−"}{formatAmount(r.amount)}</T><T v="caption" color="textSecondary">tINR</T></View>
                </Pressable>
              );
            })}
          </Card>
        </Section>
      ))}

      <Sheet visible={open !== null} onClose={() => setOpen(null)}>
        {open ? (
          <View style={{ gap: space.md }}>
            <View style={{ alignItems: "center", gap: 6 }}>
              <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: tone(open.kind)[0], alignItems: "center", justifyContent: "center" }}><Icon name={ICONS[open.kind] ?? "check"} size={26} color={tone(open.kind)[1]} /></View>
              <T v="footnote" color="textSecondary">{KINDS[open.kind] ?? "Receipt"}</T>
              <BigAmount value={formatAmount(open.amount)} color={c.text} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.tint, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 5 }}><Icon name="check" size={14} color={c.tintText} strokeWidth={3} /><T v="caption" style={{ color: c.tintText }}>Completed</T></View>
            </View>
            <View>
              <SummaryRow label="Date" value={when(open.at)} />
              {open.id !== undefined ? <SummaryRow label="Receipt number" value={`#${String(open.id)}`} last /> : <SummaryRow label="Type" value="Received" last />}
            </View>
            <T v="footnote" color="textSecondary" style={{ textAlign: "center" }}>This entry is saved on the public record and cannot be changed.</T>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <View style={{ flex: 1 }}><Button label="Share receipt" onPress={() => share(open)} /></View>
              <View style={{ flex: 1 }}><Button label="Close" variant="secondary" onPress={() => setOpen(null)} /></View>
            </View>
          </View>
        ) : null}
      </Sheet>
    </LargeTitleScreen>
  );
}
