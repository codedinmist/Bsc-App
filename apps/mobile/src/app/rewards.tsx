import { useMemo, useState } from "react";
import { type Address, encodeAbiParameters, keccak256, parseAbiParameters, zeroHash } from "viem";
import { publicClient } from "@/chain/client";
import { insuranceAbi, jackpotAbi, rewardsAbi, commissionsAbi } from "@/chain/abis";
import { contracts } from "@/chain/deployments";
import { useChain } from "@/chain/DataProvider";
import { useTx } from "@/chain/tx";
import { formatAmount, parseAmount } from "@/chain/format";
import { useWallet } from "@/wallet/WalletProvider";
import { useAsync } from "@/hooks/useAsync";
import { space, useColors } from "@/design/tokens";
import { Pressable, View } from "react-native";
import { Icon } from "@/ui/Icon";
import { HeroCard, SummaryRow } from "@/ui/kit";
import { LargeTitleScreen } from "@/ui/LargeTitleScreen";
import { AmountInput, Banner, ProgressBar, Section } from "@/ui/parts";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { T } from "@/ui/Text";
import { TxSheet } from "@/ui/TxSheet";

const MONTH = 30 * 86400;

export default function Rewards() {
  const { address } = useWallet();
  const chain = useChain();
  const [claimAmt, setClaimAmt] = useState("");
  const ready = !!(contracts.rewards && contracts.jackpot && contracts.insurance && contracts.commissions);

  const positions = useMemo(() => [
    ...chain.daily.map((p) => ({ ...p, vault: contracts.daily!, kind: "Daily saving" })),
    ...chain.rd.map((p) => ({ ...p, vault: contracts.rd!, kind: "Monthly plan" })),
    ...chain.fd.map((p) => ({ ...p, vault: contracts.fd!, kind: "Fixed deposit" })),
  ].filter((p) => p.status === 1), [chain.daily, chain.rd, chain.fd]);

  const data = useAsync(async () => {
    if (!ready || !address) return null;
    const read = <T,>(p: object) => publicClient.readContract(p as never) as Promise<T>;
    const week = await read<bigint>({ address: contracts.jackpot, abi: jackpotAbi, functionName: "weekNow" });
    const [entered, prizeNow, prizePrev, drawPrev, entrants, jpPool, minSav, savings, covered, openClaim, cover, volume, nMil] = await Promise.all([
      read<boolean>({ address: contracts.jackpot, abi: jackpotAbi, functionName: "entered", args: [week, address] }),
      read<bigint>({ address: contracts.jackpot, abi: jackpotAbi, functionName: "prize", args: [week, address] }),
      read<bigint>({ address: contracts.jackpot, abi: jackpotAbi, functionName: "prize", args: [week - 1n, address] }),
      read<readonly [bigint, boolean, number]>({ address: contracts.jackpot, abi: jackpotAbi, functionName: "draws", args: [week - 1n] }),
      read<bigint>({ address: contracts.jackpot, abi: jackpotAbi, functionName: "entrantCount", args: [week] }),
      read<bigint>({ address: contracts.jackpot, abi: jackpotAbi, functionName: "pool" }),
      read<bigint>({ address: contracts.jackpot, abi: jackpotAbi, functionName: "minSavings" }),
      read<bigint>({ address: contracts.insurance, abi: insuranceAbi, functionName: "savingsOf", args: [address] }),
      read<boolean>({ address: contracts.insurance, abi: insuranceAbi, functionName: "isCovered", args: [address] }),
      read<bigint>({ address: contracts.insurance, abi: insuranceAbi, functionName: "openClaimOf", args: [address] }),
      read<bigint>({ address: contracts.insurance, abi: insuranceAbi, functionName: "coverCap" }),
      read<bigint>({ address: contracts.commissions, abi: commissionsAbi, functionName: "agentVolume", args: [address] }),
      read<bigint>({ address: contracts.rewards, abi: rewardsAbi, functionName: "milestoneCount" }),
    ]);
    const claimed: Record<string, boolean> = {};
    for (const p of positions) {
      const key = keccak256(encodeAbiParameters(parseAbiParameters("address, uint256"), [p.vault, p.id]));
      claimed[`${p.vault}:${p.id}`] = await read<boolean>({ address: contracts.rewards, abi: rewardsAbi, functionName: "bonusClaimed", args: [key] });
    }
    const miles: { volume: bigint; reward: bigint; done: boolean }[] = [];
    for (let i = 0; i < Number(nMil); i++) {
      const [m, done] = await Promise.all([
        read<readonly [bigint, bigint]>({ address: contracts.rewards, abi: rewardsAbi, functionName: "milestones", args: [BigInt(i)] }),
        read<boolean>({ address: contracts.rewards, abi: rewardsAbi, functionName: "milestoneClaimed", args: [address, BigInt(i)] }),
      ]);
      miles.push({ volume: m[0], reward: m[1], done });
    }
    const month = BigInt(Math.floor(Date.now() / 1000 / MONTH));
    const accounts = await read<bigint>({ address: contracts.commissions, abi: commissionsAbi, functionName: "monthAccounts", args: [address, month] });
    return { week, entered, prizeNow, prizePrev, drawPrev, entrants, jpPool, minSav, savings, covered, openClaim, cover, volume, miles, claimed, month, accounts };
  }, [address, ready, positions.length], null);

  const tx = useTx(() => { chain.refresh(); data.reload(); });
  const d = data.value;
  const c = useColors();
  const amt = parseAmount(claimAmt);
  const call = (to: Address | undefined, abi: unknown, fn: string, args: unknown[], label: string) => ({ label, address: to!, abi: abi as never, functionName: fn, args });

  return (
    <LargeTitleScreen back title="Rewards" subtitle="Bonuses, Dream Club and the Sunday draw">
      {!ready ? <Section index={0}><Banner kind="warning" title="Coming soon" body="This feature is being switched on. Please check back shortly." /></Section> : null}
      {d ? (
        <Section index={1}>
          <HeroCard label="Bonuses ready to claim">
            {(() => { const n = positions.filter((p) => !d.claimed[`${p.vault}:${p.id}`]).length; return (
              <>
                <T v="money" style={{ color: "#F6F1E4", fontSize: 46, lineHeight: 54 }}>{n}<T v="callout" style={{ color: "#F6F1E4", opacity: 0.75 }}> {n === 1 ? "bonus" : "bonuses"}</T></T>
                <T v="footnote" style={{ color: "#BFD3C6" }}>{n === 0 ? "Nothing waiting right now" : "Waiting for you, paid from the reward pool"}</T>
              </>
            ); })()}
          </HeroCard>
        </Section>
      ) : null}

      {d ? (
        <Section title="Account bonuses" index={2}>
          {positions.length === 0 ? <Card><T v="body" color="textSecondary">Open a deposit first. Bonuses apply to deposits at least 30 days old: Daily 100 tINR/day for 7 days (100 tINR), Monthly 1,000+ a month (250 tINR), Fixed 25,000+ (500 tINR) or 1,00,000+ (1,500 tINR).</T></Card> : (
            <Card padded={false} style={{ overflow: "hidden" }}>
              {positions.map((p, i) => {
                const done = d.claimed[`${p.vault}:${p.id}`];
                return (
                  <View key={`${p.vault}:${p.id}`} style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: space.lg, borderBottomWidth: i === positions.length - 1 ? 0 : 1, borderBottomColor: c.hairline }}>
                    <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: c.tint, alignItems: "center", justifyContent: "center" }}><Icon name="gift" size={20} color={c.primary} /></View>
                    <View style={{ flex: 1 }}><T v="callout" style={{ fontFamily: "Inter_600SemiBold" }}>{p.kind} #{String(p.id)}</T><T v="footnote" color="textSecondary">{formatAmount(p.principal, 0)} tINR deposit</T></View>
                    {done ? <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}><Icon name="check" size={16} color={c.success} strokeWidth={3} /><T v="caption" style={{ color: c.success }}>Claimed</T></View>
                      : <Pressable onPress={() => tx.run("Claim bonus", [call(contracts.rewards, rewardsAbi, "claimAccountBonus", [p.vault, p.id], "Claim")])} accessibilityRole="button" accessibilityLabel={`Claim bonus for ${p.kind} ${String(p.id)}`} style={{ backgroundColor: c.primary, borderRadius: 99, paddingHorizontal: 16, paddingVertical: 9 }}><T v="caption" style={{ color: c.textOnPrimary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>Claim</T></Pressable>}
                  </View>
                );
              })}
            </Card>
          )}
        </Section>
      ) : null}

      {d ? (
        <Section title="Sunday draw" index={3}>
          <View style={{ backgroundColor: c.surface, borderRadius: 26, borderWidth: 1, borderColor: c.border, padding: 22, gap: space.md, overflow: "hidden" }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}><T v="money" style={{ fontSize: 30, lineHeight: 38 }}>Up to 10,000</T><T v="footnote" color="textSecondary">tINR · up to 100 winners every week</T></View>
              <Icon name="gift" size={28} color="#B08A3E" />
            </View>
            <View style={{ borderTopWidth: 2, borderStyle: "dashed", borderColor: c.border, marginHorizontal: -4 }} />
            <T v="footnote" color="textSecondary">Free to enter if you hold at least {formatAmount(d.minSav, 0)} tINR in active deposits. The prize pool holds {formatAmount(d.jpPool, 0)} tINR. This is a preview draw.</T>
            <T v="callout" style={{ fontFamily: "Inter_600SemiBold" }}>{String(d.entrants)} entered this week</T>
            <Button label={d.entered ? "You are entered ✓" : "Enter this week's draw"} disabled={d.entered} onPress={() => tx.run("Enter draw", [call(contracts.jackpot, jackpotAbi, "enter", [], "Enter")])} />
            {d.prizeNow > 0n || d.prizePrev > 0n ? (
              <>
                {d.prizePrev > 0n ? <Button label={`Claim ${formatAmount(d.prizePrev, 0)} tINR prize (last week)`} onPress={() => tx.run("Claim prize", [call(contracts.jackpot, jackpotAbi, "claim", [d.week - 1n], "Claim")])} /> : null}
              </>
            ) : null}
            {!d.drawPrev[1] ? (
              <>
                <T v="footnote" color="textSecondary">Last week's draw is not done. Anyone can run it: start it, wait a few seconds, then finish it.</T>
                <Button label="1. Start last week's draw" variant="secondary" onPress={() => tx.run("Start draw", [call(contracts.jackpot, jackpotAbi, "commitDraw", [d.week - 1n], "Start")])} />
                <Button label="2. Finish the draw" variant="secondary" onPress={() => tx.run("Finish draw", [call(contracts.jackpot, jackpotAbi, "reveal", [d.week - 1n], "Finish")])} />
              </>
            ) : <T v="footnote" color="textSecondary">Last week: {d.drawPrev[2]} winner{d.drawPrev[2] === 1 ? "" : "s"}.</T>}
          </View>
        </Section>
      ) : null}

      {d ? (
        <Section title="Insurance cover" index={4}>
          <Card style={{ gap: space.md }}>
            <T v="footnote" color="textSecondary">Savers with at least 50,000 tINR in active deposits get accident cover up to {formatAmount(d.cover, 0)} tINR, reviewed by the operations team. This is a community fund, not regulated insurance.</T>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: d.covered ? c.tint : c.surfaceAlt, alignItems: "center", justifyContent: "center" }}><Icon name="shield" size={26} color={d.covered ? c.success : c.textSecondary} /></View>
              <View style={{ flex: 1 }}><T v="title2">{d.covered ? "Covered" : "Not covered yet"}</T><T v="footnote" color="textSecondary">Cover up to {formatAmount(d.cover, 0)} tINR</T></View>
            </View>
            <SummaryRow label="Your active deposits" value={formatAmount(d.savings, 0)} last />
            {d.openClaim > 0n ? <Chip kind="info" label={`Claim #${String(d.openClaim)} is being reviewed`} /> : d.covered ? (
              <>
                <AmountInput value={claimAmt} onChangeText={setClaimAmt} placeholder="Claim amount" suffix="tINR" />
                <Button label="File an accident claim" disabled={!amt || amt === 0n || amt > d.cover} onPress={() => tx.run("File claim", [call(contracts.insurance, insuranceAbi, "fileClaim", [0, amt, 0n, zeroHash], "File claim")])} />
              </>
            ) : null}
          </Card>
        </Section>
      ) : null}

      {d && d.volume > 0n ? (
        <Section title="Agent rewards" index={5}>
          <Card style={{ gap: space.md }}>
            <T v="callout">Customers' deposits you looked after: {formatAmount(d.volume, 0)} tINR</T>
            <T v="callout">Accounts this month: {String(d.accounts)} of 25 for the Super Recruiter booster</T>
            <ProgressBar value={Number(d.accounts) / 25} />
            <Button label="Claim Super Recruiter booster" variant="secondary" disabled={d.accounts < 25n} onPress={() => tx.run("Claim booster", [call(contracts.rewards, rewardsAbi, "claimBooster", [d.month], "Claim")])} />
            {d.miles.map((m, i) => (
              <Pressable key={i} disabled={m.done || d.volume < m.volume} accessibilityRole="button" accessibilityLabel={`Dream Club ${i + 1}`}
                onPress={() => tx.run("Claim Dream Club", [call(contracts.rewards, rewardsAbi, "claimMilestone", [BigInt(i)], "Claim")])}
                style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 10 }}>
                <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: m.done ? c.primary : "transparent", borderWidth: m.done ? 0 : 2, borderColor: c.border }}>
                  {m.done ? <Icon name="check" size={17} color={c.textOnPrimary} strokeWidth={3} /> : <T v="caption" color="textSecondary" style={{ fontFamily: "Inter_700Bold" }}>{i + 1}</T>}
                </View>
                <View style={{ flex: 1 }}><T v="callout" style={{ fontFamily: "Inter_600SemiBold" }}>Dream Club {i + 1}</T><T v="footnote" color="textSecondary">{formatAmount(m.volume, 0)} volume</T></View>
                <View style={{ alignItems: "flex-end" }}><T v="headline" style={{ fontFamily: "Lora_600SemiBold" }}>{formatAmount(m.reward, 0)}</T><T v="caption" color={!m.done && d.volume >= m.volume ? "success" : "textSecondary"}>{m.done ? "tINR" : d.volume >= m.volume ? "Claim" : "tINR"}</T></View>
              </Pressable>
            ))}
            <T v="footnote" color="textSecondary">Dream Club prize amounts are set by governance and shown here as previews.</T>
          </Card>
        </Section>
      ) : null}
      <TxSheet state={tx.state} onClose={tx.reset} />
    </LargeTitleScreen>
  );
}
