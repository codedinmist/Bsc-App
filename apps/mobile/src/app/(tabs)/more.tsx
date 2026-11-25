import { View } from "react-native";
import { useRouter } from "expo-router";
import { useColors } from "@/design/tokens";
import { useWallet } from "@/wallet/WalletProvider";
import { shortAddr } from "@/chain/format";
import { LargeTitleScreen } from "@/ui/LargeTitleScreen";
import { Card } from "@/ui/Card";
import { T } from "@/ui/Text";
import { List, Row, Section } from "@/ui/parts";

export default function More() {
  const router = useRouter();
  const c = useColors();
  const { address } = useWallet();
  return (
    <LargeTitleScreen title="More">
      <Section index={0}>
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.primary, alignItems: "center", justifyContent: "center" }}><T v="title2" style={{ color: "#F4EEDC" }}>J</T></View>
          <View style={{ flex: 1 }}><T v="headline">My wallet</T><T v="footnote" color="textSecondary">{address ? shortAddr(address) : ""}</T></View>
          <View style={{ borderWidth: 1, borderColor: c.warning, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 }}><T v="caption" style={{ color: c.warning, letterSpacing: 0.8 }}>PREVIEW</T></View>
        </Card>
      </Section>
      <Section title="Money" index={1}>
        <List>
          <Row icon="book" title="Passbook" subtitle="Deposit and payment receipts" onPress={() => router.push("/passbook")} />
          <Row icon="drop" title="Add money" subtitle="Top up your wallet for free" onPress={() => router.push("/faucet")} />
          <Row icon="info" title="Notifications" subtitle="Updates about your accounts and orders" onPress={() => router.push("/notifications")} last />
        </List>
      </Section>
      <Section title="For agents" index={2}>
        <List>
          <Row icon="shield" title="Agent tools" subtitle="Stake, cash orders, commissions" onPress={() => router.push("/agent")} />
          <Row icon="credit" title="Rank and network" subtitle="How agents move up and earn" onPress={() => router.push("/network")} />
          <Row icon="bridge" title="District model" subtitle="Yearly numbers for one district" onPress={() => router.push("/district")} last />
        </List>
      </Section>
      <Section title="About" index={3}>
        <List>
          <Row icon="help" title="Help" subtitle="Guides, meanings and a quick tour" onPress={() => router.push("/help")} />
          <Row icon="shield" title="Public numbers" subtitle="Live totals and contract addresses" onPress={() => router.push("/transparency")} />
          <Row icon="lock" title="Settings and security" subtitle="Theme, wallet, recovery" onPress={() => router.push("/settings")} last />
        </List>
      </Section>
    </LargeTitleScreen>
  );
}
