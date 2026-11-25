import { useRouter } from "expo-router";
import { View } from "react-native";
import { useChain } from "@/chain/DataProvider";
import { formatAmount } from "@/chain/format";
import { active, sumPrincipal } from "@/lib/portfolio";
import { LargeTitleScreen } from "@/ui/LargeTitleScreen";
import { Section } from "@/ui/parts";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";
import { T } from "@/ui/Text";
import { Icon, type IconName } from "@/ui/Icon";
import { Pressable } from "react-native";
import { radius, space, useColors } from "@/design/tokens";
import { Donut } from "@/ui/Donut";
import { CountUp } from "@/ui/CountUp";
import { PlanCard, planInk, type PlanTone } from "@/ui/kit";

function Product({ icon, name, line, tone, onPress, mine }: { icon: IconName; name: string; line: string; tone: PlanTone; onPress: () => void; mine: [string, string] }) {
  const ink = planInk(tone);
  return (
    <PlanCard tone={tone} onPress={onPress}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <View style={{ width: 44, height: 44, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center" }}><Icon name={icon} size={22} color={ink} /></View>
        <View style={{ flex: 1 }}><T v="title2" style={{ color: ink, fontSize: 19, lineHeight: 25 }}>{name}</T><T v="footnote" style={{ color: ink, opacity: 0.8 }}>{line}</T></View>
        <Icon name="chevron" size={18} color={ink} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 18 }}>
        <T v="caption" style={{ color: ink, fontFamily: "Inter_600SemiBold" }}>{mine[0]}</T>
        <T v="headline" style={{ color: ink, fontFamily: "Lora_600SemiBold" }}>{mine[1]}</T>
      </View>
    </PlanCard>
  );
}

export default function Savings() {
  const router = useRouter();
  const d = useChain();
  const c = useColors();
  const fd = sumPrincipal(d.fd), rd = sumPrincipal(d.rd), dl = sumPrincipal(d.daily), tot = fd + rd + dl;
  const pct = (v: bigint) => (tot === 0n ? 0 : Number((v * 10000n) / tot) / 100);
  const legend = [["Fixed", pct(fd), "#0A3D2C"], ["Monthly", pct(rd), "#B08A3E"], ["Daily", pct(dl), "#7DB594"]] as const;
  const mine = (xs: typeof d.daily): [string, string] => (active(xs).length ? [`${active(xs).length} active`, formatAmount(sumPrincipal(xs))] : ["Not started", "Begin today"]);
  return (
    <LargeTitleScreen title="Save" subtitle="Your money stays yours, and visible">
      {tot > 0n ? (
        <Section index={0}>
          <Card style={{ gap: space.md, borderRadius: 28 }}>
            <T v="callout" style={{ fontFamily: "Inter_700Bold" }}>Where your money is</T>
            <Donut parts={legend.map(([, p, col]) => ({ pct: p, color: col }))}>
              <CountUp value={Number(tot / 10n ** 16n) / 100} format={(n) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 })} style={{ fontSize: 22, lineHeight: 28, color: c.text }} />
              <T v="caption" color="textSecondary">Total saved</T>
            </Donut>
            <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 4 }}>
              {legend.map(([n, p, col]) => (<View key={n} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: col }} /><T v="footnote">{n} <T v="footnote" style={{ fontFamily: "Inter_700Bold" }}>{Math.round(p)}%</T></T></View>))}
            </View>
          </Card>
        </Section>
      ) : null}
      <Section index={1}>
        <Product icon="lock" name="Fixed deposit" line="Lock once, collect at maturity" tone="gold" mine={mine(d.fd)} onPress={() => router.push("/fd")} />
        <Product icon="clock" name="Monthly plan" line="The same amount every month" tone="green" mine={mine(d.rd)} onPress={() => router.push("/rd")} />
        <Product icon="savings" name="Daily saving" line="A little, every day" tone="emerald" mine={mine(d.daily)} onPress={() => router.push("/daily")} />
      </Section>
      <Section index={2}>
        <T v="footnote" color="textSecondary" style={{ marginLeft: 4 }}>Returns are estimates. Rewards are paid only from a pool funded in advance. If the pool cannot cover a reward, the app says so and your deposit still comes back in full under the plan's rules.</T>
      </Section>
    </LargeTitleScreen>
  );
}
