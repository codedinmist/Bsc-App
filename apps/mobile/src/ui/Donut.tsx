import { View, type ViewStyle } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useColors } from "@/design/tokens";
import type { ReactNode } from "react";

const R = 68, L = 2 * Math.PI * R;

/** Ring chart. `parts` percentages should add to about 100. Static drawing, no animated props. */
export function Donut({ parts, children, size = 170 }: { parts: { pct: number; color: string }[]; children?: ReactNode; size?: number }) {
  const c = useColors();
  let off = 0;
  const style: ViewStyle = { width: size, height: size, alignSelf: "center", alignItems: "center", justifyContent: "center" };
  return (
    <View style={style}>
      <Svg width={size} height={size} viewBox="0 0 170 170" style={{ transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={85} cy={85} r={R} fill="none" stroke={c.surfaceAlt} strokeWidth={22} />
        {parts.map((p, i) => {
          const len = Math.max(0, Math.round((L * p.pct / 100 - 3) * 100) / 100);
          const el = len > 0 ? <Circle key={i} cx={85} cy={85} r={R} fill="none" stroke={p.color} strokeWidth={22} strokeDasharray={`${len} ${Math.round(L)}`} strokeDashoffset={-(L * off / 100)} /> : null;
          off += p.pct; return el;
        })}
      </Svg>
      <View style={{ position: "absolute", alignItems: "center" }}>{children}</View>
    </View>
  );
}
