import { useCallback, useState } from "react";
import { View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { isAddress, keccak256, toHex, type Address } from "viem";
import { publicClient } from "@/chain/client";
import { commissionsAbi, escrowAbi } from "@/chain/abis";
import { contracts } from "@/chain/deployments";
import { useChain } from "@/chain/DataProvider";
import { useTx, type Step } from "@/chain/tx";
import { approvalSteps } from "@/chain/actions";
import { E, formatAmount, parseAmount, shortAddr, countdown } from "@/chain/format";
import { useWallet } from "@/wallet/WalletProvider";
import { useAsync } from "@/hooks/useAsync";
import { useNow } from "@/hooks/useNow";
import { api, type AgentInfo } from "@/lib/api";
import { copyTemporarily } from "@/lib/clipboard";
import { space, useColors } from "@/design/tokens";
import { LargeTitleScreen } from "@/ui/LargeTitleScreen";
import { AmountInput, Banner, List, Row, Section, Segmented } from "@/ui/parts";
import { TextField } from "@/ui/TextField";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { T } from "@/ui/Text";
import { Avatar, HeroAmountInput, HeroCard, SummaryRow } from "@/ui/kit";
import { Pressable } from "react-native";
import { Icon } from "@/ui/Icon";
import { TxSheet } from "@/ui/TxSheet";

type Order = { id: bigint; locker: Address; beneficiary: Address; amount: bigint; createdAt: bigint; deadline: bigint; kind: number; status: number };
const STATUS = ["", "Open", "Released", "Refunded", "In dispute", "Returned to sender", "Paid to receiver"];

export default function Pay() {
  const c = useColors();
  const { address } = useWallet();
  const chain = useChain();
  const now = useNow(1000);
  const escrow = contracts.escrow as Address | undefined;
  const [mode, setMode] = useState<"out" | "in">("out");
  const [agent, setAgent] = useState("");
  const [amount, setAmount] = useState("");
  const [pincode, setPincode] = useState("");
  const [found, setFound] = useState<AgentInfo[] | null>(null);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [myAgent, setMyAgent] = useState("");
  const [agentName, setAgentName] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const orders = useAsync<Order[]>(async () => {
    if (!escrow || !address) return [];
    const head = await publicClient.getBlockNumber();
    const fromBlock = head > 45_000n ? head - 45_000n : 0n;
    const ev = escrowAbi.find((x) => x.type === "event" && x.name === "OrderCreated")!;
    const [a, b] = await Promise.all([
      publicClient.getLogs({ address: escrow, event: ev as never, args: { locker: address } as never, fromBlock }),
      publicClient.getLogs({ address: escrow, event: ev as never, args: { beneficiary: address } as never, fromBlock }),
    ]);
    const ids = [...new Set([...a, ...b].map((l) => (l as unknown as { args: { id: bigint } }).args.id))].sort((x, y) => (x < y ? 1 : -1)).slice(0, 20);
    const rows = await publicClient.multicall({ allowFailure: false, contracts: ids.map((id) => ({ address: escrow, abi: escrowAbi, functionName: "orders", args: [id] })) } as never) as unknown as readonly (readonly unknown[])[];
    return rows.map((r, i) => ({ id: ids[i], locker: r[0] as Address, beneficiary: r[1] as Address, amount: r[2] as bigint, createdAt: r[3] as bigint, deadline: r[4] as bigint, kind: Number(r[5]), status: Number(r[6]) }));
  }, [address, escrow], []);

  const referrer = useAsync<string>(async () => {
    if (!contracts.commissions || !address) return "";
    return (await publicClient.readContract({ address: contracts.commissions, abi: commissionsAbi, functionName: "referrerOf", args: [address] })) as string;
  }, [address], "");

  const tx = useTx(() => { chain.refresh(); orders.reload(); referrer.reload(); });
  const step = (label: string, fn: string, args: unknown[]): Step => ({ label, address: escrow!, abi: escrowAbi as never, functionName: fn, args });

  const search = async () => {
    setSearchErr(null);
    try { setFound((await api.agents({ pincode })).agents); } catch (e) { setFound(null); setSearchErr(e instanceof Error ? e.message : "Search failed"); }
  };

  const amt = parseAmount(amount);
  const validOut = !!escrow && isAddress(agent) && amt !== null && amt >= E(10) && amt <= E(100_000) && chain.tinr >= amt;
  const lockOut = async () => {
    if (!validOut || !address || !amt) return;
    const approve = await approvalSteps(address, escrow!, amt, "Allow the escrow to hold your tINR");
    tx.run("Lock tINR for cash-out", [...approve, step("Lock tINR in escrow", "createOrder", [1, agent as Address, amt, 7200])], { amount: formatAmount(amt), rows: [{ label: "Agent", value: shortAddr(agent) }, { label: "Held in escrow for", value: "2 hours" }] });
  };

  return (
    <LargeTitleScreen title="Pay" subtitle="Cash in and out with agents near you">
      {!escrow ? <Section index={0}><Banner kind="warning" title="Coming soon" body="This feature is being switched on. Please check back shortly." /></Section> : null}

      <Section index={1}>
        <Segmented options={[{ label: "Cash out", value: "out" as const }, { label: "Cash in", value: "in" as const }]} value={mode} onChange={setMode} />
      </Section>

      {mode === "out" ? (
        <>
          <Section title="Amount" index={2}>
            <HeroAmountInput value={amount} onChangeText={setAmount} quick={[500, 1000, 5000, 10000]} />
            <T v="footnote" color="textSecondary">You have {formatAmount(chain.tinr)} tINR. From 10 to 1,00,000 per order.</T>
          </Section>

          <Section title="Choose an agent" index={3}>
            <Card padded={false} style={{ overflow: "hidden" }}>
              {found?.map((a, i) => {
                const on = agent.toLowerCase() === a.address.toLowerCase();
                return (
                  <Pressable key={a.address} onPress={() => { setAgent(a.address); setAgentName(a.name); }} accessibilityRole="button" accessibilityState={{ selected: on }}
                    style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: space.lg, backgroundColor: on ? c.tint : "transparent", borderBottomWidth: i === found.length - 1 ? 0 : 1, borderBottomColor: c.hairline }}>
                    <Avatar letter={a.name} />
                    <View style={{ flex: 1 }}><T v="callout" style={{ fontFamily: "Inter_600SemiBold" }}>{a.name}</T><T v="footnote" color="textSecondary">{a.district} · {shortAddr(a.address)}</T></View>
                    {on ? <Icon name="check" size={20} color={c.primary} strokeWidth={2.6} /> : <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><Icon name="shield" size={15} color={c.success} /><T v="caption" style={{ color: c.success }}>Verified</T></View>}
                  </Pressable>
                );
              })}
              {!found?.length ? (
                <View style={{ padding: space.lg, gap: space.md }}>
                  <T v="footnote" color="textSecondary">{found?.length === 0 ? "No agents found for that pincode. Try a nearby one." : "Search by pincode to see verified agents near you."}</T>
                </View>
              ) : null}
            </Card>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <View style={{ flex: 1 }}><TextField label="Pincode" value={pincode} onChangeText={setPincode} keyboardType="number-pad" maxLength={6} placeholder="e.g. 560001" /></View>
            </View>
            <Button label="Find agents" variant="secondary" onPress={search} disabled={pincode.length < 4} />
            {searchErr ? <T v="footnote" color="textSecondary">{searchErr === "Backend not connected" ? "Agent search is not available right now. Paste your agent's address below instead." : searchErr}</T> : null}
            <Pressable onPress={() => setShowSearch(!showSearch)} accessibilityRole="button"><T v="callout" style={{ color: c.primary }}>{showSearch ? "Hide address entry" : "Have an address? Enter it instead"}</T></Pressable>
            {showSearch ? <TextField label="Agent wallet address" value={agent} onChangeText={(v) => { setAgent(v); setAgentName(""); }} placeholder="0x…" /> : null}
          </Section>

          <Section index={4}>
            <Card style={{ paddingVertical: space.xs }}>
              <SummaryRow label="Held safely for" value="2 hours" />
              <SummaryRow label="If the agent does not pay" value="Full refund" last />
            </Card>
            <Button label={agentName ? `Continue with ${agentName.split(" ")[0]}` : "Continue"} onPress={lockOut} disabled={!validOut} />
            <T v="footnote" color="textSecondary" style={{ textAlign: "center" }}>Your tINR stays in escrow until you confirm you have the cash.</T>
          </Section>
        </>
      ) : (
        <Section title="Cash in with an agent" index={2}>
          <HeroCard label="How it works">
            <T v="body" style={{ color: "#F6F1E4" }}>The agent puts their own tINR in escrow first, so you can see it is funded before you hand over any cash. Show the agent your address and they start the order.</T>
          </HeroCard>
          <Card style={{ paddingVertical: space.xs }}>
            <Row icon="copy" title="Copy my address" subtitle={address ? shortAddr(address) : ""} onPress={() => address && copyTemporarily(address)} last />
          </Card>
        </Section>
      )}

      <Section title="Your orders" index={3}>
        {orders.value.length === 0 ? <Card><T v="body" color="textSecondary">{orders.loading ? "Loading…" : "No orders yet."}</T></Card> : orders.value.map((o) => {
          const mineLocker = o.locker.toLowerCase() === address?.toLowerCase();
          const other = mineLocker ? o.beneficiary : o.locker;
          const open = o.status === 1;
          const late = now > Number(o.deadline);
          return (
            <Card key={String(o.id)} style={{ gap: space.md }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <T v="headline">{o.kind === 1 ? "Cash-out" : "Cash-in"} · {formatAmount(o.amount, 0)} tINR</T>
                <Chip kind={open ? "info" : o.status === 2 || o.status === 6 ? "success" : "warning"} label={STATUS[o.status]} />
              </View>
              <T v="footnote" color="textSecondary">#{String(o.id)} · with {shortAddr(other)} · you {mineLocker ? "locked the tINR" : "receive the tINR"}</T>
              {open ? <T v="footnote" color="textSecondary">{late ? "Deadline passed" : `Time left ${countdown(Number(o.deadline) - now)}`}</T> : null}
              {open && mineLocker ? <Button label={o.kind === 1 ? "I received the cash: release tINR" : "I received the cash: release tINR to me"} onPress={() => tx.run("Release tINR", [step("Release", "release", [o.id])])} /> : null}
              {open && mineLocker && late ? <Button label="Refund my tINR" variant="secondary" onPress={() => tx.run("Refund", [step("Refund", "refund", [o.id])])} /> : null}
              {open && !mineLocker ? <Button label="The other side is not releasing: open dispute" variant="danger" onPress={() => tx.run("Open dispute", [step("Open dispute", "openDispute", [o.id, keccak256(toHex(`dispute:${o.id}:${Date.now()}`))])])} /> : null}
              {o.status === 4 ? <Button label="Appeal the proposed decision" variant="secondary" onPress={() => tx.run("Appeal", [step("Appeal", "appeal", [o.id])])} /> : null}
              {(o.status === 2 || o.status === 6) && escrow ? (
                <View style={{ alignItems: "center", gap: 8, padding: space.lg, borderRadius: 18, backgroundColor: c.surfaceAlt }}>
                  <QRCode value={`jansetu://order/${o.id}?chain=97&escrow=${escrow}`} size={120} color={c.text} backgroundColor="transparent" />
                  <T v="caption" color="textSecondary">Proof of order #{String(o.id)}. Anyone can verify it on-chain.</T>
                </View>
              ) : null}
            </Card>
          );
        })}
      </Section>

      <Section title="Your agent" index={4}>
        <Card style={{ gap: space.md }}>
          {referrer.value && referrer.value !== "0x0000000000000000000000000000000000000000" ? (
            <T v="body">Your agent: {shortAddr(referrer.value)}</T>
          ) : (
            <>
              <T v="footnote" color="textSecondary">Choose the agent who looks after you. This is permanent and decides who earns commission on your deposits. It never costs you anything.</T>
              <TextField label="Agent wallet address" value={myAgent} onChangeText={setMyAgent} placeholder="0x…" />
              <Button label="Choose this agent" variant="secondary" disabled={!isAddress(myAgent) || !contracts.commissions} onPress={() => tx.run("Choose your agent", [{ label: "Choose agent", address: contracts.commissions!, abi: commissionsAbi as never, functionName: "setReferrer", args: [myAgent] }])} />
            </>
          )}
        </Card>
      </Section>
      <TxSheet state={tx.state} onClose={tx.reset} />
    </LargeTitleScreen>
  );
}
