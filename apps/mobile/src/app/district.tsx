import { useState } from "react";
import { View } from "react-native";
import { space } from "@/design/tokens";
import { crore, DECK_DISTRICT, DECK_INPUTS, districtModel, type DistrictInputs } from "@/lib/district";
import { LargeTitleScreen } from "@/ui/LargeTitleScreen";
import { Banner, ProgressBar, Section, Stat } from "@/ui/parts";
import { Card } from "@/ui/Card";
import { Chip } from "@/ui/Chip";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";
import { T } from "@/ui/Text";

const num = (s: string, fallback: number) => { const n = Number(s.replace(/,/g, "")); return Number.isFinite(n) && n >= 0 ? n : fallback; };

export default function District() {
  const [f, setF] = useState({ agents: "100", tvl: "0.725", gross: "29.79", customer: "15.45", network: "8.76", ops: "0.0085" });
  const set = (k: keyof typeof f) => (v: string) => setF((o) => ({ ...o, [k]: v }));
  const inp: DistrictInputs = {
    agents: Math.min(1000, Math.round(num(f.agents, 0))), tvlPerAgentCr: num(f.tvl, 0), grossPct: Math.min(100, num(f.gross, 0)),
    customerPct: Math.min(100, num(f.customer, 0)), networkPct: Math.min(100, num(f.network, 0)), opsPerAgentCr: num(f.ops, 0),
  };
  const m = districtModel(inp);
  const isDeck = Math.abs(m.surplus - DECK_DISTRICT.surplusCr) < 0.01 && inp.agents === DECK_DISTRICT.agents;
  const reset = () => setF({ agents: "100", tvl: String(DECK_INPUTS.tvlPerAgentCr), gross: DECK_INPUTS.grossPct.toFixed(2), customer: DECK_INPUTS.customerPct.toFixed(2), network: DECK_INPUTS.networkPct.toFixed(2), ops: String(DECK_INPUTS.opsPerAgentCr) });
  const bar = (v: number) => (m.gross > 0 ? Math.max(0, Math.min(1, v / m.gross)) : 0);

  return (
    <LargeTitleScreen title="District model" subtitle="What a district earns in a year, from the deck" back>
      <Section index={0}>
        <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
          <Chip kind="projected" label="Estimate only" />
          {isDeck ? <Chip kind="info" label="Deck numbers" /> : <Chip kind="warning" label="Your what-if" />}
        </View>
      </Section>

      <Section title="Net surplus per year" index={1}>
        <Card style={{ gap: space.lg }}>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
            <T v="money" style={{ fontVariant: ["tabular-nums"], color: m.surplus >= 0 ? undefined : "#B3443B" }} numberOfLines={1} adjustsFontSizeToFit>{crore(m.surplus)}</T>
          </View>
          <T v="footnote" color="textSecondary">{inp.agents} agents · {(m.margin * 100).toFixed(1)}% of gross revenue is left after payouts and costs.</T>
          <View style={{ gap: space.md }}>
            {([["Customer returns and bonuses", m.customer], ["Commissions, bonuses and rewards", m.network], ["Technology, audit, insurance, operations", m.ops], ["Net surplus", Math.max(0, m.surplus)]] as const).map(([label, v]) => (
              <View key={label} style={{ gap: 6 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}><T v="footnote">{label}</T><T v="footnote" color="textSecondary" style={{ fontVariant: ["tabular-nums"] }}>{crore(v)}</T></View>
                <ProgressBar value={bar(v)} />
              </View>
            ))}
          </View>
          <View style={{ flexDirection: "row" }}>
            <Stat label="Yearly fund inflow (TVL)" value={crore(m.tvl)} />
            <Stat label="Gross revenue" value={crore(m.gross)} />
          </View>
        </Card>
      </Section>

      <Section title="Change the assumptions" index={2}>
        <Card style={{ gap: space.md }}>
          <TextField label="Agents in the district" value={f.agents} onChangeText={set("agents")} keyboardType="number-pad" />
          <TextField label="Yearly inflow per agent (₹ crore)" value={f.tvl} onChangeText={set("tvl")} keyboardType="decimal-pad" />
          <TextField label="Gross revenue (% of inflow)" value={f.gross} onChangeText={set("gross")} keyboardType="decimal-pad" />
          <TextField label="Customer returns and bonuses (% of inflow)" value={f.customer} onChangeText={set("customer")} keyboardType="decimal-pad" />
          <TextField label="Commissions, bonuses, rewards (% of inflow)" value={f.network} onChangeText={set("network")} keyboardType="decimal-pad" />
          <TextField label="Running cost per agent (₹ crore)" value={f.ops} onChangeText={set("ops")} keyboardType="decimal-pad" />
          <Button label="Back to the deck's numbers" variant="secondary" onPress={reset} />
        </Card>
      </Section>

      <Section index={3}>
        <Banner kind="warning" title="An estimate, not a promise" body="These figures come from the pitch deck's one-district example (100 agents, ₹72.50 Cr inflow, ₹3.20 Cr surplus) and scale in a straight line. Real results depend on deposits, defaults, yields and rules. The deck itself says independent financial modelling is needed." />
      </Section>
    </LargeTitleScreen>
  );
}
