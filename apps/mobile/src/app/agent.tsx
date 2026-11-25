import { useState } from "react";
import { isAddress, type Address } from "viem";
import { publicClient } from "@/chain/client";
import { commissionsAbi, escrowAbi, microAbi, ranksAbi, registryAbi, stakingAbi } from "@/chain/abis";
import { contracts } from "@/chain/deployments";
import { useChain } from "@/chain/DataProvider";
import { useTx, type Step } from "@/chain/tx";
import { approvalSteps } from "@/chain/actions";
import { E, formatAmount, formatDate, parseAmount } from "@/chain/format";
import { useWallet } from "@/wallet/WalletProvider";
import { useAsync } from "@/hooks/useAsync";
import { api } from "@/lib/api";
import { listAgent } from "@/lib/kyc";
import { useRouter } from "expo-router";
import { space } from "@/design/tokens";
import { View } from "react-native";
import { CountUp } from "@/ui/CountUp";
import { LargeTitleScreen } from "@/ui/LargeTitleScreen";
import { AmountInput, Banner, ProgressBar, Section, Segmented, Stat } from "@/ui/parts";
import { TextField } from "@/ui/TextField";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { T } from "@/ui/Text";
import { BigAmount, CheckRow, HeroCard } from "@/ui/kit";
import { TxSheet } from "@/ui/TxSheet";

export default function AgentTools() {
  const { address } = useWallet();
  const chain = useChain();
  const [stakeAmt, setStakeAmt] = useState("");
  const [unstakeAmt, setUnstakeAmt] = useState("");
  const [customer, setCustomer] = useState("");
  const [orderAmt, setOrderAmt] = useState("");
  const [applicant, setApplicant] = useState("");
  const [vaultKey, setVaultKey] = useState<"daily" | "rd" | "fd">("fd");
  const [posId, setPosId] = useState("");
  const [items, setItems] = useState<{ vault: string; id: string; slot: number; claimable: string }[] | null>(null);
  const router = useRouter();
  const [lName, setLName] = useState(""); const [lPin, setLPin] = useState(""); const [lDistrict, setLDistrict] = useState("");
  const [listed, setListed] = useState<"idle" | "busy" | "ok" | "offline">("idle");
  const validListing = lName.trim().length >= 2 && /^\d{6}$/.test(lPin) && lDistrict.trim().length >= 2;
  const submitListing = async () => {
    setListed("busy");
    try { await listAgent(lName.trim(), lPin, lDistrict.trim()); setListed("ok"); } catch { setListed("offline"); }
  };
  const ready = !!(contracts.staking && contracts.escrow && contracts.micro && contracts.commissions);

  const info = useAsync(async () => {
    if (!ready || !address) return null;
    const [isAgent, acc, eligible, minStake] = await Promise.all([
      publicClient.readContract({ address: contracts.registry!, abi: registryAbi, functionName: "isActiveAgent", args: [address] }),
      publicClient.readContract({ address: contracts.staking!, abi: stakingAbi, functionName: "accounts", args: [address] }),
      publicClient.readContract({ address: contracts.staking!, abi: stakingAbi, functionName: "isEligible", args: [address] }),
      publicClient.readContract({ address: contracts.staking!, abi: stakingAbi, functionName: "minStake" }),
    ]);
    return { isAgent, staked: acc[0], reserved: acc[1], pending: acc[2], unlockAt: acc[3], eligible, minStake };
  }, [address, ready], null);

  const tx = useTx(() => { chain.refresh(); info.reload(); });
  const d = info.value;
  const comm = useAsync(async () => { try { return (await api.commissions(address!)).items; } catch { return [] as { vault: string; id: string; slot: number; claimable: string }[]; } }, [address], [] as { vault: string; id: string; slot: number; claimable: string }[]);
  const commTotal = comm.value.reduce((a, i) => a + BigInt(i.claimable), 0n);
  const rank = useAsync(async () => {
    if (!contracts.ranks || !contracts.registry || !address) return null;
    const prof = (await publicClient.readContract({ address: contracts.registry, abi: registryAbi, functionName: "profileOf", args: [address] })) as { role: number; clusterId: number };
    if (prof.role !== 2) return null;
    const R = (functionName: string, args: unknown[] = []) => publicClient.readContract({ address: contracts.ranks!, abi: ranksAbi, functionName, args } as never) as Promise<never>;
    const [have, min, vol, volMin, head] = (await Promise.all([R("clusterAgents", [prof.clusterId]), R("clusterAgentsMin"), R("clusterVolume", [prof.clusterId]), R("clusterVolumeMin"), R("clusterHead", [prof.clusterId])])) as unknown as [number, number, bigint, bigint, string];
    const f = (a: number, b: number) => (b > 0 ? Math.min(1, a / b) : 1);
    const taken = head !== "0x0000000000000000000000000000000000000000";
    return { have, min, vol, volMin, taken, frac: (f(Number(have), Number(min)) + f(Number(vol), Number(volMin))) / 2 };
  }, [address], null);
  const stake = parseAmount(stakeAmt), unstake = parseAmount(unstakeAmt), order = parseAmount(orderAmt);
  const s = (to: Address, abi: unknown, fn: string, args: unknown[], label: string): Step => ({ label, address: to, abi: abi as never, functionName: fn, args });
  const vault = contracts[vaultKey];

  const loadCommissions = async () => {
    try { setItems((await api.commissions(address!)).items); } catch { setItems([]); }
  };

  return (
    <LargeTitleScreen title="Agent" subtitle="Stake, orders and commissions" back>
      {!ready ? <Section index={0}><Banner kind="warning" title="Coming soon" body="This feature is being switched on. Please check back shortly." /></Section> : null}
      {d && !d.isAgent ? <Section index={0}><Banner title="You are not an agent yet" body="Agents are approved by the operations team after identity and stake checks. Until then you can still stake, but orders and verification will be refused." /></Section> : null}

      {d ? (
        <Section index={1}>
          <HeroCard label="Your stake" tag={d.eligible ? "ELIGIBLE" : undefined}>
            <CountUp value={Number(d.staked / 10n ** 16n) / 100} format={(n) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 })} style={{ color: "#fff", fontSize: 46, lineHeight: 54, letterSpacing: -0.8 }} />
            <T v="footnote" style={{ color: "#BFD3C6" }}>tINR · {d.eligible ? "You can take cash orders." : `Add at least ${formatAmount(d.minStake, 0)} tINR to take orders.`}</T>
          </HeroCard>
        </Section>
      ) : null}

      {d?.isAgent ? (
        <Section index={1}>
          <Card style={{ gap: space.md }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View><T v="caption" color="textSecondary" style={{ letterSpacing: 1.3, textTransform: "uppercase" }}>Commission ready</T><T v="money" style={{ fontSize: 30, lineHeight: 38 }}>{formatAmount(commTotal, 0)} <T v="callout" color="textSecondary">tINR</T></T></View>
              <Button compact label="Claim now" disabled={commTotal === 0n || !contracts.commissions} onPress={() => tx.run("Claim commission", comm.value.slice(0, 8).map((i) => s(contracts.commissions!, commissionsAbi, "claim", [i.vault, BigInt(i.id), i.slot], `Claim #${i.id}`)), { amount: formatAmount(commTotal) })} />
            </View>
          </Card>
          {rank.value && !rank.value.taken ? (
            <Card style={{ gap: space.sm }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}><T v="headline">Next rank: Cluster Validator</T><T v="headline" style={{ color: "#B08A3E" }}>{Math.round(rank.value.frac * 100)}%</T></View>
              <ProgressBar value={rank.value.frac} />
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}><T v="footnote" color="textSecondary">{String(rank.value.have)} of {String(rank.value.min)} agents</T><T v="footnote" color="textSecondary">{formatAmount(rank.value.vol, 0)} of {formatAmount(rank.value.volMin, 0)} tINR</T></View>
            </Card>
          ) : null}
        </Section>
      ) : null}

      {d ? (
        <Section title="To stay verified" index={1}>
          <Card padded={false} style={{ paddingHorizontal: space.lg }}>
            <CheckRow done={d.isAgent} label="Approved as an agent" />
            <CheckRow done={d.eligible} label={`Stake of ${formatAmount(d.minStake, 0)} tINR or more`} />
            <CheckRow done={d.reserved > 0n || d.eligible} label="Ready for cash orders" last />
          </Card>
        </Section>
      ) : null}

      {d ? (
        <Section title="Manage stake" index={1}>
          <Card style={{ gap: space.md }}>
            <T v="footnote" color="textSecondary">Your stake backs every cash-in order. If you are proven at fault in a dispute, part of it is taken. You need at least {formatAmount(d.minStake, 0)} tINR to be eligible.</T>
            <Chip kind={d.eligible ? "success" : "warning"} label={d.eligible ? "Eligible" : "Below the minimum stake"} />
            <Stat label="Staked" value={`${formatAmount(d.staked, 0)} tINR`} />
            <Stat label="Locked in open orders" value={`${formatAmount(d.reserved, 0)} tINR`} />
            {d.pending > 0n ? <Stat label="Waiting to withdraw" value={`${formatAmount(d.pending, 0)} tINR · ${formatDate(d.unlockAt)}`} /> : null}
            <AmountInput value={stakeAmt} onChangeText={setStakeAmt} placeholder="Amount to stake" suffix="tINR" />
            <Button label="Add stake" disabled={!stake || stake === 0n || chain.tinr < stake} onPress={async () => { const a = await approvalSteps(address!, contracts.staking!, stake!); tx.run("Add stake", [...a, s(contracts.staking!, stakingAbi, "stake", [stake], "Stake")], { amount: formatAmount(stake!), rows: [{ label: "Purpose", value: "Backs your cash orders" }] }); }} />
            <AmountInput value={unstakeAmt} onChangeText={setUnstakeAmt} placeholder="Amount to unstake" suffix="tINR" />
            <Button label="Start unstake (7-day wait)" variant="secondary" disabled={!unstake || unstake === 0n} onPress={() => tx.run("Start unstake", [s(contracts.staking!, stakingAbi, "requestUnstake", [unstake], "Unstake")])} />
            {d.pending > 0n ? <Button label="Withdraw unlocked stake" variant="secondary" onPress={() => tx.run("Withdraw stake", [s(contracts.staking!, stakingAbi, "withdraw", [], "Withdraw")])} /> : null}
          </Card>
        </Section>
      ) : null}

      {d?.isAgent ? (
        <Section title="Be found by customers" index={2}>
          <Card style={{ gap: space.md }}>
            <T v="footnote" color="textSecondary">Customers search for agents by pincode. Your name and area are shared, never your exact location. You are listed only while you are verified and your stake is at least the minimum.</T>
            <TextField label="Name shown to customers" value={lName} onChangeText={setLName} placeholder="e.g. Ramesh Store, Dadar" autoCapitalize="words" />
            <TextField label="Pincode (6 digits)" value={lPin} onChangeText={setLPin} keyboardType="number-pad" maxLength={6} placeholder="400014" />
            <TextField label="District" value={lDistrict} onChangeText={setLDistrict} autoCapitalize="words" placeholder="Mumbai" />
            <Button label={listed === "ok" ? "Listed ✓" : "List me in agent search"} loading={listed === "busy"} disabled={!validListing || listed === "ok"} onPress={submitListing} />
            {listed === "offline" ? <Banner kind="warning" title="Could not reach the directory" body="Agent search needs the JanSetu backend. Check your connection and try again." /> : null}
          </Card>
        </Section>
      ) : null}

      <Section index={2}>
        <Button label="My rank and network" variant="secondary" onPress={() => router.push("/network")} />
      </Section>

      <Section title="Start a cash-in order" index={2}>
        <Card style={{ gap: space.md }}>
          <T v="footnote" color="textSecondary">You lock your own tINR first. The customer sees it is funded, hands you the cash, and you release the tINR to them. Your stake covers the whole amount while the order is open.</T>
          <TextField label="Customer wallet address" value={customer} onChangeText={setCustomer} placeholder="0x…" />
          <AmountInput value={orderAmt} onChangeText={setOrderAmt} placeholder="0" suffix="tINR" />
          <Button label="Lock tINR for 2 hours" disabled={!ready || !isAddress(customer) || !order || order < E(10) || order > E(100_000) || chain.tinr < order} onPress={async () => { const a = await approvalSteps(address!, contracts.escrow!, order!); tx.run("Start cash-in", [...a, s(contracts.escrow!, escrowAbi, "createOrder", [0, customer, order, 7200n], "Lock tINR")]); }} />
          <T v="footnote" color="textSecondary">After you have the cash, open the Pay tab to release the order.</T>
        </Card>
      </Section>

      <Section title="Verify a merchant applicant" index={3}>
        <Card style={{ gap: space.md }}>
          <T v="footnote" color="textSecondary">Confirm in person that you know this person and their shop. Your check is valid for 14 days and is recorded under your wallet.</T>
          <TextField label="Applicant wallet address" value={applicant} onChangeText={setApplicant} placeholder="0x…" />
          <Button label="Verify applicant" disabled={!ready || !isAddress(applicant)} onPress={() => tx.run("Verify applicant", [s(contracts.micro!, microAbi, "verifyApplicant", [applicant], "Verify")])} />
        </Card>
      </Section>

      <Section title="Commissions" index={4}>
        <Card style={{ gap: space.md }}>
          <T v="footnote" color="textSecondary">Commission on a customer's deposit is counted first, then paid out gradually until the deposit matures. If the customer withdraws early, the unpaid part is cancelled.</T>
          <Segmented options={[{ label: "Daily", value: "daily" as const }, { label: "Monthly", value: "rd" as const }, { label: "Fixed", value: "fd" as const }]} value={vaultKey} onChange={setVaultKey} />
          <TextField label="Deposit number" value={posId} onChangeText={setPosId} keyboardType="number-pad" placeholder="e.g. 12" />
          <Button label="Count this deposit" variant="secondary" disabled={!ready || !vault || !posId} onPress={() => tx.run("Count commission", [s(contracts.commissions!, commissionsAbi, "sync", [vault, BigInt(posId)], "Count")])} />
          <Button label="Claim my commission" disabled={!ready || !vault || !posId} onPress={() => tx.run("Claim commission", [s(contracts.commissions!, commissionsAbi, "claim", [vault, BigInt(posId), 0], "Claim")])} />
          <Button label="Show what is ready" variant="ghost" onPress={loadCommissions} />
          {items?.length === 0 ? <T v="footnote" color="textSecondary">Nothing to show, or the backend is not connected.</T> : null}
          {items?.map((i) => <T key={`${i.vault}${i.id}`} v="footnote">Deposit #{i.id}: {formatAmount(BigInt(i.claimable))} tINR ready</T>)}
        </Card>
      </Section>
      <TxSheet state={tx.state} onClose={tx.reset} />
    </LargeTitleScreen>
  );
}
