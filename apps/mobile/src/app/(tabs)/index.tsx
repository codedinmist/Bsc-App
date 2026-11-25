import { Pressable, View, useColorScheme } from "react-native";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { radius, space, useColors } from "@/design/tokens";
import { duration, ease, useMotion } from "@/design/motion";
import { useChain } from "@/chain/DataProvider";
import { useTx } from "@/chain/tx";
import { registryAbi } from "@/chain/abis";
import { contracts, isDeployed } from "@/chain/deployments";
import { BNB_TESTNET_FAUCET } from "@/chain/config";
import { formatAmount, formatDate, shortAddr } from "@/chain/format";
import { useWallet } from "@/wallet/WalletProvider";
import { copyTemporarily } from "@/lib/clipboard";
import { active, nextMaturity, sumPrincipal } from "@/lib/portfolio";
import { LargeTitleScreen } from "@/ui/LargeTitleScreen";
import { T } from "@/ui/Text";
import { Card } from "@/ui/Card";
import { Skeleton } from "@/ui/Skeleton";
import { Banner, List, Row, Section, Stat } from "@/ui/parts";
import { TxSheet } from "@/ui/TxSheet";
import { Icon } from "@/ui/Icon";
import { WalletStack } from "@/ui/WalletStack";
import { CountUp } from "@/ui/CountUp";
import { useFirstRunTour } from "@/lib/tour";
import { relayEnabled } from "@/chain/relay";
import { useAsync } from "@/hooks/useAsync";
import { Linking } from "react-native";
import { requestKyc } from "@/lib/kyc";
import { Sheet } from "@/ui/Sheet";
import { Button } from "@/ui/Button";

const MIN_BNB = 3_000_000_000_000_000n; // 0.003 BNB covers many testnet transactions

export default function Home() {
  const c = useColors();
  const router = useRouter();
  const { address } = useWallet();
  const data = useChain();
  const tx = useTx(data.refresh);
  useFirstRunTour();
  const relay = useAsync(relayEnabled, [], false);

  const dailyP = sumPrincipal(data.daily), rdP = sumPrincipal(data.rd), fdP = sumPrincipal(data.fd);
  const saved = dailyP + rdP + fdP;
  const next = nextMaturity(data.daily, data.rd, data.fd);
  const activeCount = active(data.daily).length + active(data.rd).length + active(data.fd).length;
  const hasBnb = data.bnb >= MIN_BNB || relay.value; // with free transactions on, no BNB is needed

  const [kycSheet, setKycSheet] = useState<null | "asking" | "pending" | "offline">(null);
  const askKyc = async () => {
    setKycSheet("asking");
    try { const st = await requestKyc(); if (st === "approved") { setKycSheet(null); data.refresh(); } else setKycSheet("pending"); }
    catch { setKycSheet("offline"); }
  };
  const dark = useColorScheme() === "dark";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const count = (n: number) => (n === 0 ? "Nothing here yet" : `${n} active`);
  const plans = [
    { icon: "lock" as const, title: "Fixed deposit", sub: active(data.fd).length ? `${count(active(data.fd).length)}` : "Lock a sum, get it back later", amount: fdP, go: "/fd" },
    { icon: "clock" as const, title: "Monthly plan", sub: active(data.rd).length ? `${count(active(data.rd).length)}` : "Save the same amount each month", amount: rdP, go: "/rd" },
    { icon: "savings" as const, title: "Daily saving", sub: active(data.daily).length ? `${count(active(data.daily).length)}` : "Put aside a little every day", amount: dailyP, go: "/daily" },
  ];
  const quick = [{ icon: "plus" as const, label: "Add money", go: "/faucet" }, { icon: "pay" as const, label: "Pay", go: "/pay" }, { icon: "savings" as const, label: "Save", go: "/savings" }, { icon: "gift" as const, label: "Earn", go: "/rewards" }];

  const join = () => tx.run("Join JanSetu", [{ label: "Register your wallet", address: contracts.registry!, abi: registryAbi, functionName: "register" }]);

  return (
    <LargeTitleScreen title={greeting} subtitle={address ? shortAddr(address) : undefined}>
      {!isDeployed && (
        <Section index={0}><Banner kind="warning" title="Almost ready" body="JanSetu is still being set up. Your balances will appear here shortly." /></Section>
      )}
      {data.error ? <Section><Banner kind="warning" title="You are offline" body={data.error} /></Section> : null}

      <Section index={1}>
        <WalletStack loaded={data.loaded} format={(n) => n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 })}
          cards={[
            { key: "wallet", kind: "wallet", title: "Wallet", amount: Number(data.tinr / 10n ** 16n) / 100, sub: address ? shortAddr(address) : "", caption: "", copy: address ?? undefined },
            { key: "fd", kind: "gold", title: "Fixed deposit", amount: Number(fdP / 10n ** 16n) / 100, sub: active(data.fd).length ? `${active(data.fd).length} active` : "Nothing locked yet", caption: formatAmount(fdP), onOpen: () => router.push("/fd") },
            { key: "rd", kind: "green", title: "Monthly plan", amount: Number(rdP / 10n ** 16n) / 100, sub: active(data.rd).length ? `${active(data.rd).length} active` : "Not started yet", caption: formatAmount(rdP), onOpen: () => router.push("/rd") },
          ]} />
      </Section>

      <Section index={2}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {quick.map((q) => (
            <Pressable key={q.label} onPress={() => router.push(q.go as never)} accessibilityRole="button" accessibilityLabel={q.label}
              style={({ pressed }) => ({ flex: 1, height: 68, borderRadius: 20, backgroundColor: c.surface, alignItems: "center", justifyContent: "center", gap: 5, elevation: 1, shadowColor: c.shadow, shadowOpacity: 1, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, transform: [{ scale: pressed ? 0.95 : 1 }] })}>
              <Icon name={q.icon} size={22} color={c.primary} />
              <T v="caption" color="textSecondary" style={{ fontFamily: "Inter_600SemiBold" }}>{q.label}</T>
            </Pressable>
          ))}
        </View>
      </Section>

      <Section index={3}>
        <Card style={{ gap: space.md, borderRadius: 28 }}>
          <T v="callout" style={{ fontFamily: "Inter_700Bold" }}>Total savings</T>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6 }}>
            <CountUp value={Number(saved / 10n ** 16n) / 100} format={(n) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 })} style={{ fontSize: 34, lineHeight: 42, letterSpacing: -1.1, color: c.text }} />
            <T v="callout" color="textSecondary" style={{ marginBottom: 6 }}>tINR</T>
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1, backgroundColor: c.surfaceAlt, borderRadius: 18, padding: 12, alignItems: "center" }}><T v="caption" color="textSecondary">Next payout</T><T v="headline" style={{ marginTop: 2 }}>{next ? formatDate(next) : "None yet"}</T></View>
            <View style={{ flex: 1, backgroundColor: c.surfaceAlt, borderRadius: 18, padding: 12, alignItems: "center" }}><T v="caption" color="textSecondary">Active plans</T><T v="headline" style={{ marginTop: 2 }}>{activeCount}</T></View>
          </View>
        </Card>
      </Section>

      {isDeployed && data.loaded && data.registered && data.kycRequired && !data.kyc && (
        <Section index={3}>
          <Pressable onPress={askKyc} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.warningTint, borderRadius: 18, paddingVertical: 13, paddingHorizontal: 15 }}>
            <Icon name="shield" size={22} color={c.warning} />
            <T v="callout" style={{ color: c.warning, flex: 1 }}>Finish KYC to start saving</T>
            <View style={{ backgroundColor: c.warning, borderRadius: 99, paddingHorizontal: 13, paddingVertical: 7 }}><T v="caption" style={{ color: c.warningTint, fontFamily: "Inter_700Bold" }}>Verify</T></View>
          </Pressable>
        </Section>
      )}

      {isDeployed && data.loaded && (!hasBnb || !data.registered || data.tinr === 0n || (data.kycRequired && !data.kyc)) && (
        <Section title="Get started" index={2}>
          <List>
            <Row icon="drop" title="Network fees" subtitle={relay.value ? "Covered by JanSetu, nothing to do" : hasBnb ? "Done" : "Add a little BNB, free from the BNB faucet"} right={hasBnb ? <Icon name="check" size={20} color={c.success} /> : undefined} onPress={hasBnb ? undefined : () => Linking.openURL(BNB_TESTNET_FAUCET)} />
            <Row icon="shield" title="Join JanSetu" subtitle={data.registered ? "Done" : "One quick transaction registers your wallet"} right={data.registered ? <Icon name="check" size={20} color={c.success} /> : undefined} onPress={data.registered || !hasBnb ? undefined : join} />
            {data.kycRequired ? <Row icon="lock" title="Verify your identity (KYC)" subtitle={data.kyc ? "Done" : "Needed before deposits and loans"} right={data.kyc ? <Icon name="check" size={20} color={c.success} /> : undefined} onPress={data.kyc || !data.registered ? undefined : askKyc} /> : null}
            <Row icon="savings" title="Add your first tINR" subtitle={data.tinr > 0n ? "Done" : "Top up your wallet for free"} right={data.tinr > 0n ? <Icon name="check" size={20} color={c.success} /> : undefined} onPress={data.tinr > 0n ? undefined : () => router.push("/faucet")} last />
          </List>
        </Section>
      )}

      <Section title="Your savings" index={4}>
        <List>
          {plans.map((p, i) => (
            <Row key={p.title} icon={p.icon} title={p.title} subtitle={p.sub} onPress={() => router.push(p.go as never)} last={i === plans.length - 1}
              right={<View style={{ alignItems: "flex-end" }}><T v="headline" style={{ fontVariant: ["tabular-nums"] }}>{formatAmount(p.amount)}</T><T v="caption" color="textSecondary">tINR</T></View>} />
          ))}
        </List>
        {next ? <T v="footnote" color="textSecondary" style={{ marginLeft: 4 }}>Next payout: {formatDate(next)}</T> : null}
      </Section>

      <Sheet visible={kycSheet !== null} onClose={() => kycSheet !== "asking" && setKycSheet(null)} dismissable={kycSheet !== "asking"}>
        <View style={{ gap: space.md }}>
          <T v="title2">{kycSheet === "asking" ? "Contacting the verification team…" : kycSheet === "pending" ? "Request sent" : "Verification is unavailable"}</T>
          <T v="body" color="textSecondary">
            {kycSheet === "asking" ? "Confirm with your fingerprint or face if asked." : kycSheet === "pending"
              ? "Your request is with our verification team. This banner disappears as soon as you are approved. Nothing else is needed."
              : "We could not reach the verification team just now. Share your wallet address with your JanSetu contact, who can approve it directly. You can copy it from the wallet card."}
          </T>
          {kycSheet !== "asking" ? <Button label="OK" onPress={() => { setKycSheet(null); data.refresh(); }} /> : null}
        </View>
      </Sheet>
      <TxSheet state={tx.state} onClose={tx.reset} />
    </LargeTitleScreen>
  );
}
