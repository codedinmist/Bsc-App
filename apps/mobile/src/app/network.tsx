import { useState } from "react";
import { View } from "react-native";
import type { Address } from "viem";
import { publicClient } from "@/chain/client";
import { commissionsAbi, ranksAbi, registryAbi, serviceAbi, stakingAbi } from "@/chain/abis";
import { contracts } from "@/chain/deployments";
import { useChain } from "@/chain/DataProvider";
import { useTx, type Step } from "@/chain/tx";
import { formatAmount, shortAddr } from "@/chain/format";
import { useWallet } from "@/wallet/WalletProvider";
import { useAsync } from "@/hooks/useAsync";
import { space, useColors } from "@/design/tokens";
import { LargeTitleScreen } from "@/ui/LargeTitleScreen";
import { Banner, ProgressBar, Section } from "@/ui/parts";
import { TextField } from "@/ui/TextField";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { Icon } from "@/ui/Icon";
import { T } from "@/ui/Text";
import { TxSheet } from "@/ui/TxSheet";

const RANKS = ["Not an agent", "Agent", "Cluster Validator", "District Node Lead", "State Governor"];
type Level = { name: string; short: string; have: [number, number]; vol: [bigint, bigint]; head: Address; ready: boolean; id: number; promote: "promoteCluster" | "promoteDistrict" | "promoteState" };

function Req({ ok, label, value, frac }: { ok: boolean; label: string; value: string; frac: number }) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name={ok ? "check" : "clock"} size={18} color={ok ? c.success : c.textSecondary} />
        <T v="callout" style={{ flex: 1 }}>{label}</T>
        <T v="footnote" color="textSecondary" style={{ fontVariant: ["tabular-nums"] }}>{value}</T>
      </View>
      <ProgressBar value={frac} />
    </View>
  );
}
const frac = (a: bigint | number, b: bigint | number) => { const A = Number(a), B = Number(b); return B > 0 ? Math.min(1, A / B) : 1; };

export default function Network() {
  const { address } = useWallet();
  const chain = useChain();
  const ready = !!(contracts.ranks && contracts.service && contracts.commissions && contracts.registry);
  const [orderId, setOrderId] = useState("");
  const [loanId, setLoanId] = useState("");

  const info = useAsync(async () => {
    if (!ready || !address) return null;
    const R = (functionName: string, args: unknown[] = []) => publicClient.readContract({ address: contracts.ranks!, abi: ranksAbi, functionName, args } as never) as Promise<never>;
    const S = (functionName: string, args: unknown[] = []) => publicClient.readContract({ address: contracts.service!, abi: serviceAbi, functionName, args } as never) as Promise<never>;
    const prof = (await publicClient.readContract({ address: contracts.registry!, abi: registryAbi, functionName: "profileOf", args: [address] })) as { role: number; kycVerified: boolean; agentVerified: boolean; clusterId: number; districtId: number; stateId: number };
    const [rank, own, ownMin, refs, refsMin, eligible, seen] = (await Promise.all([R("rankOf", [address]), R("ownInvestment", [address]), R("ownInvestmentMin"), R("kycReferrals", [address]), R("referralsMin"), R("isAgentEligible", [address]), R("seenVolume", [address])])) as unknown as [number, bigint, bigint, bigint, number, boolean, bigint];
    const [vol, acc, minStake] = (await Promise.all([
      publicClient.readContract({ address: contracts.commissions!, abi: commissionsAbi, functionName: "agentVolume", args: [address] }),
      publicClient.readContract({ address: contracts.staking!, abi: stakingAbi, functionName: "accounts", args: [address] }),
      publicClient.readContract({ address: contracts.staking!, abi: stakingAbi, functionName: "minStake" }),
    ])) as unknown as [bigint, readonly [bigint, bigint, bigint, bigint], bigint];
    const isAgent = prof.role === 2;
    let levels: Level[] = [];
    if (isAgent) {
      const { clusterId: cl, districtId: di, stateId: st } = prof;
      const [cA, cV, cMA, cMV, cH, dC, dV, dMC, dMV, dH, sD, sV, sMD, sMV, sH] = (await Promise.all([
        R("clusterAgents", [cl]), R("clusterVolume", [cl]), R("clusterAgentsMin"), R("clusterVolumeMin"), R("clusterHead", [cl]),
        R("clustersInDistrict", [di]), R("districtVolume", [di]), R("districtClustersMin"), R("districtVolumeMin"), R("districtHead", [di]),
        R("districtsInState", [st]), R("stateVolume", [st]), R("stateDistrictsMin"), R("stateVolumeMin"), R("stateHead", [st]),
      ])) as unknown as [number, bigint, number, bigint, Address, number, bigint, number, bigint, Address, number, bigint, number, bigint, Address];
      const none = "0x0000000000000000000000000000000000000000";
      levels = [
        { name: "Cluster Validator", short: "cluster", have: [cA, cMA], vol: [cV, cMV], head: cH, ready: cH === none && cA >= cMA && cV >= cMV, id: cl, promote: "promoteCluster" },
        { name: "District Node Lead", short: "district", have: [dC, dMC], vol: [dV, dMV], head: dH, ready: dH === none && dC >= dMC && dV >= dMV, id: di, promote: "promoteDistrict" },
        { name: "State Governor", short: "state", have: [sD, sMD], vol: [sV, sMV], head: sH, ready: sH === none && sD >= sMD && sV >= sMV, id: st, promote: "promoteState" },
      ];
    }
    const [pool, owed, pending] = (await Promise.all([S("pool"), S("districtOwed"), isAgent ? S("districtPending", [prof.districtId]) : Promise.resolve(0n)])) as unknown as [bigint, bigint, bigint];
    return { prof, rank, own, ownMin, refs, refsMin, eligible, seen, vol, staked: acc[0], minStake, isAgent, levels, pool, owed, pending };
  }, [address, ready], null);

  const tx = useTx(() => { chain.refresh(); info.reload(); });
  const d = info.value;
  const s = (to: Address, abi: unknown, fn: string, args: unknown[], label: string): Step => ({ label, address: to, abi: abi as never, functionName: fn, args });
  const none = "0x0000000000000000000000000000000000000000";
  const num = (v: string) => (/^\d{1,9}$/.test(v) ? BigInt(v) : null);

  return (
    <LargeTitleScreen title="Rank and network" subtitle="How agents qualify and move up" back>
      {!ready ? <Section index={0}><Banner kind="warning" title="Coming soon" body="This feature is being switched on. Please check back shortly." /></Section> : null}

      {d && !d.isAgent ? (
        <Section title="Become an agent" index={1}>
          <Card style={{ gap: space.lg }}>
            <T v="footnote" color="textSecondary">The deck asks for four things before an agent can be verified. The contract checks all four, so nobody can skip one.</T>
            <Req ok={d.prof.kycVerified} label="Identity check (KYC) done" value={d.prof.kycVerified ? "Done" : "Not yet"} frac={d.prof.kycVerified ? 1 : 0} />
            <Req ok={d.staked >= d.minStake} label="Stake" value={`${formatAmount(d.staked, 0)} / ${formatAmount(d.minStake, 0)} tINR`} frac={frac(d.staked, d.minStake)} />
            <Req ok={d.own >= d.ownMin} label="Your own savings" value={`${formatAmount(d.own, 0)} / ${formatAmount(d.ownMin, 0)} tINR`} frac={frac(d.own, d.ownMin)} />
            <Req ok={d.refs >= BigInt(d.refsMin)} label="Customers who chose you (KYC done)" value={`${d.refs} / ${d.refsMin}`} frac={frac(d.refs, d.refsMin)} />
            <Chip kind={d.eligible ? "success" : "warning"} label={d.eligible ? "You meet every rule. The operator desk can verify you now." : "Finish the items above"} />
            <T v="footnote" color="textSecondary">Stake in Agent tools. Open a fixed deposit for your own savings. Ask customers to open Pay and choose your wallet address as their agent: {address ? shortAddr(address) : ""}.</T>
          </Card>
        </Section>
      ) : null}

      {d && d.isAgent ? (
        <Section title="Your rank" index={1}>
          <Card style={{ gap: space.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <T v="title2">{RANKS[d.rank] ?? "Agent"}</T>
              <Chip kind={d.prof.agentVerified ? "success" : "warning"} label={d.prof.agentVerified ? "Verified" : "Waiting for verification"} />
            </View>
            <T v="footnote" color="textSecondary">Area: cluster {d.prof.clusterId} · district {d.prof.districtId} · state {d.prof.stateId}</T>
            <T v="callout">Counted volume: {formatAmount(d.vol, 0)} tINR</T>
            <T v="footnote" color="textSecondary">Volume is the total of your customers' deposits, counted when someone presses Count. {d.seen < d.vol ? `${formatAmount(d.vol - d.seen, 0)} tINR is not added to your area yet.` : "Your area totals are up to date."}</T>
            <Button label="Update my area totals" variant="secondary" disabled={!ready || d.seen >= d.vol && d.rank > 0} onPress={() => tx.run("Update area totals", [s(contracts.ranks!, ranksAbi, "syncAgent", [address], "Update")])} />
          </Card>
        </Section>
      ) : null}

      {d?.levels.map((l, i) => (
        <Section key={l.name} title={l.name} index={2 + i}>
          <Card style={{ gap: space.md }}>
            <Req ok={l.have[0] >= l.have[1]} label={l.short === "cluster" ? "Active agents" : l.short === "district" ? "Clusters with a head" : "Districts with a head"} value={`${l.have[0]} / ${l.have[1]}`} frac={frac(l.have[0], l.have[1])} />
            <Req ok={l.vol[0] >= l.vol[1]} label="Volume" value={`${formatAmount(l.vol[0], 0)} / ${formatAmount(l.vol[1], 0)}`} frac={frac(l.vol[0], l.vol[1])} />
            {l.head !== none ? <T v="footnote" color="textSecondary">Head: {l.head.toLowerCase() === address?.toLowerCase() ? "you" : shortAddr(l.head)}</T> : <T v="footnote" color="textSecondary">The agent with the most counted volume in the area becomes head. Anyone can press Promote once the numbers are met.</T>}
            {l.head === none ? <Button label={l.ready ? `Promote ${l.short}` : "Numbers not reached yet"} variant="secondary" disabled={!l.ready} onPress={() => tx.run(`Promote ${l.short}`, [s(contracts.ranks!, ranksAbi, l.promote, [l.id], "Promote")])} /> : null}
          </Card>
        </Section>
      ))}

      {ready ? (
        <Section title="Service commissions" index={6}>
          <Card style={{ gap: space.md }}>
            <T v="footnote" color="textSecondary">Besides savings commissions, agents earn on cash orders (1.5%) and on loan repayments they verified (2.5%). Cluster heads earn 0.75% of team loans, state heads 1% of turnover, and district heads share the prediction-market fees. Anyone can press these buttons; each payment happens once and comes from a funded pool{d ? ` (${formatAmount(d.pool, 0)} tINR now)` : ""}.</T>
            <TextField label="Finished cash order number" value={orderId} onChangeText={setOrderId} keyboardType="number-pad" placeholder="e.g. 3" />
            <Button label="Pay commission for this order" variant="secondary" disabled={!num(orderId)} onPress={() => tx.run("Pay order commission", [s(contracts.service!, serviceAbi, "syncP2P", [num(orderId)], "Pay")])} />
            <TextField label="Loan number" value={loanId} onChangeText={setLoanId} keyboardType="number-pad" placeholder="e.g. 1" />
            <Button label="Pay loan commissions" variant="secondary" disabled={!num(loanId)} onPress={() => tx.run("Pay loan commissions", [s(contracts.service!, serviceAbi, "syncLoan", [num(loanId)], "Pay")])} />
            <Button label="Share new prediction-market fees" variant="ghost" onPress={() => tx.run("Share prediction fees", [s(contracts.service!, serviceAbi, "sweepPrediction", [], "Share")])} />
            {d?.isAgent ? <Button label={`Pay my district's share${d.pending > 0n ? ` (${formatAmount(d.pending)} tINR)` : ""}`} variant="ghost" disabled={d.pending === 0n} onPress={() => tx.run("Pay district share", [s(contracts.service!, serviceAbi, "payDistrict", [d.prof.districtId], "Pay")])} /> : null}
          </Card>
        </Section>
      ) : null}
      <TxSheet state={tx.state} onClose={tx.reset} />
    </LargeTitleScreen>
  );
}
