import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { publicClient } from "@/chain/client";
import { dailyAbi, erc20Abi, fdAbi, rdAbi, multisigAbi, timelockAbi, commissionsAbi, serviceAbi, rewardsAbi } from "@/chain/abis";
import { addressUrl } from "@/chain/config";
import { contracts, isDeployed } from "@/chain/deployments";
import { formatAmount, shortAddr } from "@/chain/format";
import { LargeTitleScreen } from "@/ui/LargeTitleScreen";
import { Banner, Section, Stat } from "@/ui/parts";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";
import { Skeleton } from "@/ui/Skeleton";
import { T } from "@/ui/Text";
import type { Address } from "viem";

type Totals = { principal: bigint; pool: bigint; reserved: bigint; balance: bigint; solvent: boolean };

async function totals(vault: Address, abi: typeof dailyAbi | typeof rdAbi | typeof fdAbi): Promise<Totals> {
  const r = (fn: "totalPrincipal" | "rewardPool" | "totalRewardLiability" | "isSolvent") => publicClient.readContract({ address: vault, abi, functionName: fn } as never);
  const [principal, pool, reserved, solvent, balance] = await Promise.all([
    r("totalPrincipal"), r("rewardPool"), r("totalRewardLiability"), r("isSolvent"),
    publicClient.readContract({ address: contracts.token!, abi: erc20Abi, functionName: "balanceOf", args: [vault] }),
  ]);
  return { principal: principal as bigint, pool: pool as bigint, reserved: reserved as bigint, solvent: solvent as boolean, balance };
}

const SEATS = ["Founder", "State Governor representative", "External security auditor", "Top agent representative", "Cold backup key"];
type Gov = { owners: Address[]; threshold: bigint; delayH: number; proposals: { id: number; approvals: bigint; executed: boolean }[]; treasury: bigint; commission: bigint; service: bigint; rewards: bigint };

/** Deck slide 12: 3-of-5 multisig + 48 hour public timelock, read straight from the chain. Nothing here can be changed from the app. */
async function loadGovernance(): Promise<Gov | null> {
  if (!contracts.multisig || !contracts.timelock) return null;
  const read = (address: Address, abi: unknown, functionName: string, args: unknown[] = []) => publicClient.readContract({ address, abi, functionName, args } as never) as Promise<never>;
  const [owners, threshold, delay, count] = (await Promise.all([read(contracts.multisig, multisigAbi, "owners"), read(contracts.multisig, multisigAbi, "threshold"), read(contracts.timelock, timelockAbi, "getMinDelay"), read(contracts.multisig, multisigAbi, "txCount")])) as unknown as [Address[], bigint, bigint, bigint];
  const ids = Array.from({ length: Math.min(5, Number(count)) }, (_, i) => Number(count) - 1 - i);
  const proposals = await Promise.all(ids.map(async (id) => {
    const [t, a] = (await Promise.all([read(contracts.multisig!, multisigAbi, "getTx", [BigInt(id)]), read(contracts.multisig!, multisigAbi, "validConfirmations", [BigInt(id)])])) as unknown as [{ executed: boolean }, bigint];
    return { id, approvals: a, executed: t.executed };
  }));
  const bal = (a?: Address) => (a ? (publicClient.readContract({ address: contracts.token!, abi: erc20Abi, functionName: "balanceOf", args: [a] }) as Promise<bigint>) : Promise.resolve(0n));
  const [treasury, commission, service, rewards] = await Promise.all([
    bal(contracts.treasury),
    contracts.commissions ? (read(contracts.commissions, commissionsAbi, "pool") as Promise<bigint>) : Promise.resolve(0n),
    contracts.service ? (read(contracts.service, serviceAbi, "pool") as Promise<bigint>) : Promise.resolve(0n),
    contracts.rewards ? (read(contracts.rewards, rewardsAbi, "pool") as Promise<bigint>) : Promise.resolve(0n),
  ]);
  return { owners, threshold, delayH: Number(delay) / 3600, proposals, treasury, commission, service, rewards };
}

export default function Transparency() {
  const [gov, setGov] = useState<Gov | null>(null);
  useEffect(() => { if (isDeployed) loadGovernance().then(setGov).catch(() => setGov(null)); }, []);
  const [rows, setRows] = useState<{ name: string; addr: Address; t: Totals }[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (!isDeployed) return;
    Promise.all([
      totals(contracts.daily!, dailyAbi).then((t) => ({ name: "Daily saving vault", addr: contracts.daily!, t })),
      totals(contracts.rd!, rdAbi).then((t) => ({ name: "Monthly plan vault", addr: contracts.rd!, t })),
      totals(contracts.fd!, fdAbi).then((t) => ({ name: "Fixed vault", addr: contracts.fd!, t })),
    ]).then(setRows).catch(() => setErr(true));
  }, []);

  return (
    <LargeTitleScreen title="Transparency" subtitle="Live numbers read straight from the blockchain" back>
      <Section index={0}><Chip kind="success" label="On-chain · read live" /></Section>
      {!isDeployed ? <Section><Banner kind="warning" title="Nothing to show yet" body="JanSetu is still being set up. Details will appear here once it goes live." /></Section> : null}
      {err ? <Section><Banner kind="error" title="Can't reach the network" /></Section> : null}
      {isDeployed && !rows && !err ? <Skeleton height={140} /> : null}
      {rows?.map((r, i) => (
        <Section key={r.name} title={r.name} index={i + 1}>
          <Card style={{ gap: 16 }}>
            <View style={{ flexDirection: "row" }}>
              <Stat label="Customers' deposits" value={formatAmount(r.t.principal)} />
              <Stat label="Funded reward pool" value={formatAmount(r.t.pool)} />
            </View>
            <View style={{ flexDirection: "row" }}>
              <Stat label="Rewards reserved" value={formatAmount(r.t.reserved)} />
              <Stat label="Tokens held" value={formatAmount(r.t.balance)} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Chip kind={r.t.solvent ? "success" : "error"} label={r.t.solvent ? "Holdings cover every recorded amount" : "Shortfall detected"} />
              <T v="footnote" color="primary" onPress={() => Linking.openURL(addressUrl(r.addr))} accessibilityRole="link">{shortAddr(r.addr)}</T>
            </View>
          </Card>
        </Section>
      ))}
      {gov ? (
        <Section title="Who controls the treasury" index={5}>
          <Card style={{ gap: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <T v="headline">{String(gov.threshold)}-of-{gov.owners.length} multi-signature</T>
              <Chip kind="success" label={`${gov.delayH} hour public timelock`} />
            </View>
            <T v="footnote" color="textSecondary">Any treasury transfer or rule change needs {String(gov.threshold)} of these {gov.owners.length} approvals and then waits {gov.delayH} hours in public before it can run. Today the five keys are held by the founding team. At launch they pass to five independent people.</T>
            {gov.owners.map((o, i) => (
              <View key={o} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <T v="footnote">{SEATS[i] ?? `Owner ${i + 1}`}</T>
                <T v="footnote" color="primary" onPress={() => Linking.openURL(addressUrl(o))} accessibilityRole="link">{shortAddr(o)}</T>
              </View>
            ))}
            <View style={{ flexDirection: "row" }}>
              <Stat label="Treasury holds" value={`${formatAmount(gov.treasury, 0)} tINR`} />
              <Stat label="Proposals so far" value={String(gov.proposals.length ? gov.proposals[0].id + 1 : 0)} />
            </View>
            {gov.proposals.map((p) => <T key={p.id} v="footnote" color="textSecondary">Proposal #{p.id}: {String(p.approvals)} of {String(gov.threshold)} approvals · {p.executed ? "executed" : "waiting"}</T>)}
          </Card>
        </Section>
      ) : null}
      {gov ? (
        <Section title="Funded pools" index={6}>
          <Card style={{ gap: 12 }}>
            <View style={{ flexDirection: "row" }}><Stat label="Savings commissions" value={formatAmount(gov.commission, 0)} /><Stat label="Service commissions" value={formatAmount(gov.service, 0)} /></View>
            <View style={{ flexDirection: "row" }}><Stat label="Bonuses and Dream Club" value={formatAmount(gov.rewards, 0)} /></View>
            <T v="footnote" color="textSecondary">Every commission and bonus is paid only from these funded pools, never from customers' savings.</T>
          </Card>
        </Section>
      ) : null}
      {isDeployed ? <Section><T v="footnote" color="textSecondary" style={{ marginLeft: 4 }}>Amounts are shown in tINR. Rewards are paid only from the funded pool, never from anyone's deposit.</T></Section> : null}
    </LargeTitleScreen>
  );
}
