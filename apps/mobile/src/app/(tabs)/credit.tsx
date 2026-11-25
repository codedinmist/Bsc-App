import { useMemo, useState } from "react";
import { View } from "react-native";
import { type Address } from "viem";
import { publicClient } from "@/chain/client";
import { collAbi, dailyAbi, microAbi, poolAbi, scoreAbi, vaultPledgeAbi } from "@/chain/abis";
import { contracts } from "@/chain/deployments";
import { useChain, type RawPosition } from "@/chain/DataProvider";
import { useTx, type Step } from "@/chain/tx";
import { approvalSteps } from "@/chain/actions";
import { formatAmount, formatDate, parseAmount, shortAddr } from "@/chain/format";
import { useWallet } from "@/wallet/WalletProvider";
import { useAsync } from "@/hooks/useAsync";
import { space } from "@/design/tokens";
import { LargeTitleScreen } from "@/ui/LargeTitleScreen";
import { AmountInput, Banner, ProgressBar, Section, Segmented, Stat } from "@/ui/parts";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { T } from "@/ui/Text";
import { BigAmount, HeroCard, PillRow, StepSlider, SummaryRow } from "@/ui/kit";
import { Pressable } from "react-native";
import { useColors } from "@/design/tokens";
import { TxSheet } from "@/ui/TxSheet";

type Pos = RawPosition & { vault: Address; kind: "Daily saving" | "Monthly plan" | "Fixed deposit" };
type VLoan = { id: bigint; principal: bigint; totalDue: bigint; installment: bigint; paid: bigint; count: number; paidCount: number; nextDue: bigint; tier: number; status: number };
type CLoan = { id: bigint; collateral: bigint; principal: bigint; owed: bigint; paid: bigint; dueAt: bigint; status: number; vault: Address; positionId: bigint };

const PCT = [25, 50, 80] as const;
const TERMS = [30, 90, 180] as const;

export default function Credit() {
  const { address } = useWallet();
  const c = useColors();
  const chain = useChain();
  const [pct, setPct] = useState<(typeof PCT)[number]>(50);
  const [term, setTerm] = useState<(typeof TERMS)[number]>(30);
  const [posKey, setPosKey] = useState<string | null>(null);
  const [lpAmount, setLpAmount] = useState("");

  const positions: Pos[] = useMemo(() => [
    ...chain.daily.map((p) => ({ ...p, vault: contracts.daily!, kind: "Daily saving" as const })),
    ...chain.rd.map((p) => ({ ...p, vault: contracts.rd!, kind: "Monthly plan" as const })),
    ...chain.fd.map((p) => ({ ...p, vault: contracts.fd!, kind: "Fixed deposit" as const })),
  ].filter((p) => p.status === 1 && p.collateralEligible && p.principal > p.locked), [chain.daily, chain.rd, chain.fd]);
  const chosen = positions.find((p) => `${p.vault}:${p.id}` === posKey) ?? positions[0];

  const ready = !!(contracts.micro && contracts.coll && contracts.score && contracts.pool);

  const data = useAsync(async () => {
    if (!ready || !address) return null;
    const [score, record, tokenId, active, completed, verifiedBy, verifiedAt, defaulted, minScore, lp, lpShares, poolAssets, poolIdle] = await Promise.all([
      publicClient.readContract({ address: contracts.score!, abi: scoreAbi, functionName: "scoreOf", args: [address] }),
      publicClient.readContract({ address: contracts.score!, abi: scoreAbi, functionName: "recordOf", args: [address] }),
      publicClient.readContract({ address: contracts.score!, abi: scoreAbi, functionName: "tokenOf", args: [address] }),
      publicClient.readContract({ address: contracts.micro!, abi: microAbi, functionName: "activeLoanOf", args: [address] }),
      publicClient.readContract({ address: contracts.micro!, abi: microAbi, functionName: "completedCount", args: [address] }),
      publicClient.readContract({ address: contracts.micro!, abi: microAbi, functionName: "verifiedBy", args: [address] }),
      publicClient.readContract({ address: contracts.micro!, abi: microAbi, functionName: "verifiedAt", args: [address] }),
      publicClient.readContract({ address: contracts.micro!, abi: microAbi, functionName: "hasDefaulted", args: [address] }),
      publicClient.readContract({ address: contracts.micro!, abi: microAbi, functionName: "minScore" }),
      publicClient.readContract({ address: contracts.pool!, abi: poolAbi, functionName: "lpValue", args: [address] }),
      publicClient.readContract({ address: contracts.pool!, abi: poolAbi, functionName: "shares", args: [address] }),
      publicClient.readContract({ address: contracts.pool!, abi: poolAbi, functionName: "totalAssets" }),
      publicClient.readContract({ address: contracts.pool!, abi: poolAbi, functionName: "idle" }),
    ]);
    let vloan: VLoan | null = null;
    if (active > 0n) {
      const l = await publicClient.readContract({ address: contracts.micro!, abi: microAbi, functionName: "getLoan", args: [active] });
      vloan = { id: active, principal: l.principal, totalDue: l.totalDue, installment: l.installment, paid: l.paid, count: l.count, paidCount: l.paidCount, nextDue: l.nextDue, tier: l.tier, status: l.status };
    }
    // eligible daily accounts for the merchant loan
    const eligible: bigint[] = [];
    for (const p of chain.daily.filter((x) => x.status === 1)) {
      const [acc, used] = await Promise.all([
        publicClient.readContract({ address: contracts.daily!, abi: dailyAbi, functionName: "accounts", args: [p.id] }),
        publicClient.readContract({ address: contracts.micro!, abi: microAbi, functionName: "positionUsed", args: [p.id] }),
      ]);
      if (acc[0] >= 100n * 10n ** 18n && acc[2] >= 15 && !used) eligible.push(p.id);
    }
    // collateral loans (last ~45k blocks)
    const head = await publicClient.getBlockNumber();
    const ev = collAbi.find((x) => x.type === "event" && x.name === "Borrowed")!;
    const logs = await publicClient.getLogs({ address: contracts.coll!, event: ev as never, args: { borrower: address } as never, fromBlock: head > 45_000n ? head - 45_000n : 0n });
    const ids = logs.map((l) => (l as unknown as { args: { id: bigint } }).args.id).slice(-10);
    const cl: CLoan[] = [];
    for (const id of ids) {
      const l = await publicClient.readContract({ address: contracts.coll!, abi: collAbi, functionName: "getLoan", args: [id] });
      cl.push({ id, collateral: l.collateral, principal: l.principal, owed: l.owed, paid: l.paid, dueAt: l.dueAt, status: l.status, vault: l.vault, positionId: l.positionId });
    }
    return { score, record, tokenId, completed, verifiedBy, verifiedAt, defaulted, minScore, lp, lpShares, poolAssets, poolIdle, vloan, eligible, cl: cl.reverse() };
  }, [address, ready, chain.daily.length], null);

  const tx = useTx(() => { chain.refresh(); data.reload(); });
  const d = data.value;
  const nowSec = Math.floor(Date.now() / 1000);

  const coll = useMemo(() => {
    if (!chosen) return null;
    const unlocked = chosen.principal - chosen.locked;
    const collateral = (unlocked * BigInt(pct)) / 100n;
    const principal = (collateral * 80n) / 100n; // up to the 80% limit of what is pledged
    const interest = (principal * 1200n * BigInt(term)) / (365n * 10_000n);
    return { collateral, principal, interest };
  }, [chosen, pct, term]);

  const borrowAgainst = () => {
    if (!chosen || !coll) return;
    const steps: Step[] = [
      { label: "Pledge part of your deposit", address: chosen.vault, abi: vaultPledgePledge as never, functionName: "pledge", args: [chosen.id, coll.collateral, contracts.coll!] },
      { label: "Receive your loan", address: contracts.coll!, abi: collAbi as never, functionName: "borrow", args: [chosen.vault, chosen.id, coll.collateral, coll.principal, BigInt(term)] },
    ];
    tx.run("Loan against savings", steps, { amount: formatAmount(coll.principal), rows: [{ label: "Pledged savings", value: `${formatAmount(coll.collateral)} tINR` }, { label: "Interest", value: `${formatAmount(coll.interest)} tINR over ${term} days` }] });
  };

  const repayCollateral = async (l: CLoan) => {
    const need = l.owed - l.paid;
    const approve = await approvalSteps(address!, contracts.coll!, need, "Allow repayment");
    tx.run("Repay loan", [...approve, { label: "Repay in full", address: contracts.coll!, abi: collAbi as never, functionName: "repay", args: [l.id, need] }], { amount: formatAmount(need) });
  };

  const repayVyapar = async (l: VLoan, n: number) => {
    const amt = l.installment * BigInt(n);
    const approve = await approvalSteps(address!, contracts.micro!, amt, "Allow repayment");
    tx.run("Repay merchant loan", [...approve, { label: `Pay ${n} instalment${n > 1 ? "s" : ""}`, address: contracts.micro!, abi: microAbi as never, functionName: "repay", args: [l.id, n] }], { amount: formatAmount(amt), rows: [{ label: "Instalments", value: String(n) }] });
  };

  const lpAmt = parseAmount(lpAmount);

  return (
    <LargeTitleScreen title="Borrow" subtitle="Against your savings, up to 80%">
      {!ready ? <Section index={0}><Banner kind="warning" title="Coming soon" body="This feature is being switched on. Please check back shortly." /></Section> : null}

      {d ? (
        <Section title="Your credit score" index={1}>
          <HeroCard label="Credit score" tag={d.tokenId === 0n ? undefined : "VERIFIED"}>
            <BigAmount value={String(d.score)} unit="of 900" size={52} />
            <View style={{ height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.15)", overflow: "hidden", marginTop: 6 }}><View style={{ height: 8, borderRadius: 4, backgroundColor: "#E2B864", width: `${Math.round(Math.max(0, Math.min(1, (Number(d.score) - 300) / 600)) * 100)}%` }} /></View>
            <View style={{ flexDirection: "row", marginTop: 10 }}>
              {([["On time", d.record.onTime], ["Late", d.record.late], ["Completed", d.record.completed], ["Defaults", d.record.defaults]] as const).map(([k, v]) => (
                <View key={k} style={{ flex: 1 }}><T v="caption" style={{ color: "#BFD3C6" }}>{k}</T><T v="headline" style={{ color: "#F6F1E4", fontFamily: "Lora_600SemiBold" }}>{String(v)}</T></View>
              ))}
            </View>
          </HeroCard>
          <T v="footnote" color="textSecondary">Paying on time raises your score. A score of {String(d.minScore)} or more, plus one finished loan, unlocks the larger merchant loan without an agent check.</T>
          {d.tokenId === 0n ? <Button label="Create my score token" variant="secondary" onPress={() => tx.run("Create score token", [{ label: "Create", address: contracts.score!, abi: scoreAbi as never, functionName: "mint", args: [] }])} /> : null}
        </Section>
      ) : null}

      {d ? (
        <Section title="Merchant loan (Vyapar)" index={2}>
          {d.vloan ? (
            <Card style={{ gap: space.md }}>
              <T v="headline">{formatAmount(d.vloan.principal, 0)} tINR loan · tier {d.vloan.tier + 1}</T>
              <ProgressBar value={d.vloan.paidCount / d.vloan.count} />
              <T v="footnote" color="textSecondary">{d.vloan.paidCount} of {d.vloan.count} daily payments made · {formatAmount(d.vloan.installment, 0)} tINR each</T>
              <T v="footnote" color="textSecondary">Next payment due {formatDate(d.vloan.nextDue)}{Number(d.vloan.nextDue) < nowSec ? " (late)" : ""}</T>
              <View style={{ gap: space.sm }}>
                <Button label="Pay today's instalment" onPress={() => repayVyapar(d.vloan!, 1)} />
                <Button label="Pay 7 instalments" variant="secondary" onPress={() => repayVyapar(d.vloan!, Math.min(7, d.vloan!.count - d.vloan!.paidCount))} />
              </View>
            </Card>
          ) : (
            <Card style={{ gap: space.md }}>
              <T v="footnote" color="textSecondary">Save 100 tINR a day for 15 days as a Daily saving, then get checked by an agent. You receive 10,000 tINR and repay 100 tINR a day for 120 days (12,000 in total).</T>
              <T v="callout">Eligible daily savings accounts: {d.eligible.length}</T>
              <T v="callout">Agent check: {d.verifiedBy === "0x0000000000000000000000000000000000000000" ? "not done" : `by ${shortAddr(d.verifiedBy)}${nowSec > Number(d.verifiedAt) + 14 * 86400 ? " (expired)" : ""}`}</T>
              {d.defaulted ? <Banner kind="error" title="Blocked" body="A previous loan was defaulted, so new merchant loans are blocked." /> : null}
              <Button label="Get a 10,000 tINR loan" disabled={!d.eligible.length || d.defaulted} onPress={() => tx.run("Merchant loan", [{ label: "Borrow", address: contracts.micro!, abi: microAbi as never, functionName: "borrow", args: [0, d.eligible[0]] }])} />
              {d.completed > 0n ? <Button label="Get a 50,000 tINR loan (score based)" variant="secondary" disabled={d.score < d.minScore} onPress={() => tx.run("Large merchant loan", [{ label: "Borrow", address: contracts.micro!, abi: microAbi as never, functionName: "borrow", args: [1, 0] }])} /> : null}
            </Card>
          )}
        </Section>
      ) : null}

      <Section title="Borrow against savings" index={3}>
        {!chosen ? <Card><T v="body" color="textSecondary">You need an active deposit that allows borrowing. Open a daily, monthly or fixed deposit first.</T></Card> : (
          <>
            <Card style={{ gap: space.lg, padding: space.xl }}>
              <View style={{ gap: 4 }}>
                <T v="caption" color="textSecondary" style={{ letterSpacing: 1.3, textTransform: "uppercase" }}>You receive</T>
                <BigAmount value={coll ? formatAmount(coll.principal) : "0"} color={c.text} />
              </View>
              <StepSlider steps={PCT} value={pct} onChange={setPct} format={(v) => `${v}%`} />
              <T v="footnote" color="textSecondary">Pledge {pct}% of your deposit. Up to 80% of what you pledge is yours right away, and your deposit keeps earning.</T>
            </Card>
            <T v="caption" color="textSecondary" style={{ letterSpacing: 1.3, textTransform: "uppercase", marginLeft: 4 }}>Pledge from</T>
            <Card padded={false} style={{ overflow: "hidden" }}>
              {positions.slice(0, 5).map((p, i, arr) => {
                const k = `${p.vault}:${p.id}`; const on = chosen === p;
                return (
                  <Pressable key={k} onPress={() => setPosKey(k)} accessibilityRole="button" accessibilityState={{ selected: on }}
                    style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: space.lg, backgroundColor: on ? c.tint : "transparent", borderBottomWidth: i === arr.length - 1 ? 0 : 1, borderBottomColor: c.hairline }}>
                    <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: on ? c.primary : c.border, alignItems: "center", justifyContent: "center" }}>{on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.primary }} /> : null}</View>
                    <View style={{ flex: 1 }}><T v="callout">{p.kind} #{String(p.id)}</T></View>
                    <T v="footnote" color="textSecondary">{formatAmount(p.principal - p.locked, 0)} free</T>
                  </Pressable>
                );
              })}
            </Card>
            <T v="caption" color="textSecondary" style={{ letterSpacing: 1.3, textTransform: "uppercase", marginLeft: 4 }}>Repay within</T>
            <PillRow options={TERMS.map((x) => ({ label: `${x} days`, value: x }))} value={term} onChange={setTerm} />
            {coll ? (
              <Card style={{ paddingVertical: space.xs }}>
                <SummaryRow label="You pledge" value={`${formatAmount(coll.collateral)}`} />
                <SummaryRow label="Interest (12% a year)" value={formatAmount(coll.interest)} />
                <SummaryRow label={`Total to repay by day ${term}`} value={formatAmount(coll.principal + coll.interest)} strong last />
              </Card>
            ) : null}
            {coll ? <T v="footnote" color="textSecondary">If you do not repay within 3 days after the due date, only the amount owed is taken from your pledge.</T> : null}
            <Button label="Pledge and borrow" onPress={borrowAgainst} disabled={!ready || !coll || coll.principal === 0n} />
          </>
        )}
        {d?.cl.map((l) => (
          <Card key={String(l.id)} style={{ gap: space.sm }}>
            <T v="headline">Loan #{String(l.id)} · {formatAmount(l.principal, 0)} tINR</T>
            <T v="footnote" color="textSecondary">Owed {formatAmount(l.owed - l.paid)} · due {formatDate(l.dueAt)} · {["", "Active", "Repaid", "Taken from pledge"][l.status]}</T>
            {l.status === 1 ? <Button label="Repay in full" onPress={() => repayCollateral(l)} /> : null}
          </Card>
        ))}
      </Section>

      {d ? (
        <Section title="Fund the loan pool" index={4}>
          <Card style={{ gap: space.md }}>
            <T v="footnote" color="textSecondary">Anyone can add tINR to the pool that funds loans. Your share earns the interest borrowers pay. A borrower who never repays can reduce your value, so this is not risk-free.</T>
            <View style={{ flexDirection: "row" }}><Stat label="Pool size" value={formatAmount(d.poolAssets, 0)} /><Stat label="Free cash" value={formatAmount(d.poolIdle, 0)} /><Stat label="Your value" value={formatAmount(d.lp)} /></View>
            <AmountInput value={lpAmount} onChangeText={setLpAmount} placeholder="0" suffix="tINR" />
            <Button label="Add to pool" disabled={!lpAmt || lpAmt === 0n || chain.tinr < lpAmt} onPress={async () => { const a = await approvalSteps(address!, contracts.pool!, lpAmt!); tx.run("Add to loan pool", [...a, { label: "Deposit", address: contracts.pool!, abi: poolAbi as never, functionName: "deposit", args: [lpAmt] }]); }} />
            {d.lpShares > 0n ? <Button label="Withdraw everything available" variant="secondary" onPress={() => tx.run("Withdraw from pool", [{ label: "Withdraw", address: contracts.pool!, abi: poolAbi as never, functionName: "withdraw", args: [d.lpShares] }])} /> : null}
          </Card>
        </Section>
      ) : null}
      <TxSheet state={tx.state} onClose={tx.reset} />
    </LargeTitleScreen>
  );
}

const vaultPledgePledge = vaultPledgeAbi;
