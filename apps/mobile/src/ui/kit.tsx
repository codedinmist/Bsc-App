import { useState, type ReactNode } from "react";
import { Pressable, TextInput, View, type LayoutChangeEvent, type TextInputProps } from "react-native";
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { useColors } from "@/design/tokens";
import { T } from "./Text";
import { Icon } from "./Icon";

/** Deep-green feature card with a faint arch pattern. Used for headline numbers. */
export function HeroCard({ label, children, tag, action, onAction }: { label: string; children: ReactNode; tag?: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ backgroundColor: "#0A3D2C", borderRadius: 28, padding: 22, overflow: "hidden", gap: 6 }}>
      <Svg width={280} height={280} viewBox="0 0 280 280" style={{ position: "absolute", right: -60, top: -30, opacity: 0.14 }} pointerEvents="none">
        {[130, 108, 86, 64, 42].map((r) => <Path key={r} d={`M${140 - r} 300V${140}a${r} ${r} 0 0 1 ${2 * r} 0V300`} stroke="#F6F1E4" strokeWidth={1.2} fill="none" />)}
      </Svg>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <T v="caption" style={{ color: "#BFD3C6", letterSpacing: 1.3, textTransform: "uppercase" }}>{label}</T>
        {action ? <Pressable onPress={onAction} accessibilityRole="button" hitSlop={8} style={{ borderWidth: 1, borderColor: "#B08A3E", borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 }}><T v="caption" style={{ color: "#E2B864", fontFamily: "Inter_600SemiBold" }}>{action}</T></Pressable> : tag ? <View style={{ borderWidth: 1, borderColor: "#B08A3E", borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 }}><T v="caption" style={{ color: "#E2B864", letterSpacing: 0.8 }}>{tag}</T></View> : null}
      </View>
      {children}
    </View>
  );
}

/** Big serif amount with the unit beside it. */
export function BigAmount({ value, unit = "tINR", color = "#FFFFFF", size = 44 }: { value: string; unit?: string; color?: string; size?: number }) {
  const len = value.length;
  const s = len <= 6 ? size : len <= 8 ? size - 6 : len <= 10 ? size - 12 : size - 18;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6 }}>
      <T v="money" style={{ color, fontSize: s, lineHeight: s + 8, fontVariant: ["tabular-nums"] }}>{value}</T>
      <T v="callout" style={{ color, opacity: 0.75, marginBottom: 6 }}>{unit}</T>
    </View>
  );
}

/** Large amount entry on the page itself (no box), with quick-pick chips. */
export function HeroAmountInput({ value, onChangeText, quick, suffix = "tINR" }: { value: string; onChangeText: (v: string) => void; quick?: number[]; suffix?: string }) {
  const c = useColors();
  const group = (raw: string) => { const [i, d] = raw.split("."); return (i ? Number(i).toLocaleString("en-IN") : "") + (d !== undefined ? "." + d : ""); };
  const shown = group(value);
  const n = shown.length;
  const size = n <= 6 ? 52 : n <= 8 ? 44 : 36;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
        <TextInput value={shown} onChangeText={(t) => onChangeText(t.replace(/[^0-9.]/g, "").replace(/^(\d*\.\d*).*$/, "$1"))} placeholder="0" keyboardType="decimal-pad" placeholderTextColor={c.border} accessibilityLabel="Amount"
          style={{ flexShrink: 1, minWidth: 60, fontFamily: "Lora_500Medium", fontSize: size, color: c.text, padding: 0, fontVariant: ["tabular-nums"] }} />
        <T v="body" color="textSecondary" style={{ marginBottom: 8 }}>{suffix}</T>
      </View>
      {quick ? (
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {quick.map((q) => <Pill key={q} label={q.toLocaleString("en-IN")} on={value === String(q)} onPress={() => onChangeText(String(q))} />)}
        </View>
      ) : null}
    </View>
  );
}

export function Pill({ label, on, onPress }: { label: string; on?: boolean; onPress?: () => void }) {
  const c = useColors();
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress?.(); }} accessibilityRole="button" accessibilityState={{ selected: !!on }}
      style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, backgroundColor: on ? c.primary : c.surface, borderWidth: 1, borderColor: on ? c.primary : c.border }}>
      <T v="caption" style={{ color: on ? c.textOnPrimary : c.text, fontFamily: "Inter_600SemiBold", fontSize: 13 }} numberOfLines={1}>{label}</T>
    </Pressable>
  );
}

export function PillRow<V extends string | number>({ options, value, onChange }: { options: { label: string; value: V }[]; value: V; onChange: (v: V) => void }) {
  return (
    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
      {options.map((o) => <Pill key={String(o.value)} label={o.label} on={o.value === value} onPress={() => onChange(o.value)} />)}
    </View>
  );
}

export function Avatar({ letter, size = 42 }: { letter: string; size?: number }) {
  const c = useColors();
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.surfaceAlt, alignItems: "center", justifyContent: "center" }}><T v="headline" style={{ fontFamily: "Lora_600SemiBold", color: c.primary }}>{letter.slice(0, 1).toUpperCase()}</T></View>;
}

export function CheckRow({ done, label, last }: { done: boolean; label: string; last?: boolean }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 13, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.hairline }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: done ? c.primary : "transparent", borderWidth: done ? 0 : 2, borderColor: c.border }}>
        {done ? <Icon name="check" size={16} color={c.textOnPrimary} strokeWidth={3} /> : null}
      </View>
      <T v="callout" color={done ? "text" : "textSecondary"}>{label}</T>
    </View>
  );
}

/** Two-line label/value row with a hairline under it. */
export function SummaryRow({ label, value, strong, last }: { label: string; value: string; strong?: boolean; last?: boolean }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 13, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.hairline }}>
      <T v="body" color="textSecondary">{label}</T>
      <T v="headline" style={{ fontFamily: "Lora_600SemiBold", fontSize: strong ? 19 : 16, fontVariant: ["tabular-nums"] }}>{value}</T>
    </View>
  );
}

/** Stepped slider. Tap or drag along the track to pick one of the steps. State changes only, no animated values. */
export function StepSlider<V extends number>({ steps, value, onChange, format }: { steps: readonly V[]; value: V; onChange: (v: V) => void; format: (v: V) => string }) {
  const c = useColors();
  const [w, setW] = useState(0);
  const idx = Math.max(0, steps.indexOf(value));
  const frac = steps.length > 1 ? idx / (steps.length - 1) : 0;
  const THUMB = 30;
  const pick = (x: number) => {
    if (!w) return;
    const f = Math.max(0, Math.min(1, (x - THUMB / 2) / (w - THUMB)));
    const i = Math.round(f * (steps.length - 1));
    if (steps[i] !== value) { Haptics.selectionAsync().catch(() => {}); onChange(steps[i]); }
  };
  return (
    <View>
      <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={{ height: 40, justifyContent: "center" }}
        onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => pick(e.nativeEvent.locationX)} onResponderMove={(e) => pick(e.nativeEvent.locationX)}
        accessible accessibilityRole="adjustable" accessibilityValue={{ text: format(value) }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => { const n = e.nativeEvent.actionName === "increment" ? Math.min(steps.length - 1, idx + 1) : Math.max(0, idx - 1); onChange(steps[n]); }}>
        <View pointerEvents="none" style={{ height: 8, borderRadius: 4, backgroundColor: c.surfaceAlt }} />
        <View pointerEvents="none" style={{ position: "absolute", left: 0, height: 8, borderRadius: 4, backgroundColor: c.primary, width: THUMB / 2 + frac * Math.max(0, w - THUMB) }} />
        <View pointerEvents="none" style={{ position: "absolute", left: frac * Math.max(0, w - THUMB), width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: c.surface, borderWidth: 2, borderColor: c.primary, elevation: 3, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } }} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        {steps.map((s) => <T key={s} v="caption" color={s === value ? "text" : "textSecondary"} style={{ fontFamily: s === value ? "Inter_700Bold" : "Inter_500Medium" }}>{format(s)}</T>)}
      </View>
    </View>
  );
}

export type PlanTone = "gold" | "green" | "emerald";
const TONES = {
  gold: { a: "#F0D690", b: "#C99E45", c: "#6E4D16", ink: "#2C1C05", line: "#5A3F10", lineOp: 0.32 },
  green: { a: "#7DB594", b: "#3C7A5F", c: "#1F4F3B", ink: "#FFFFFF", line: "#FFFFFF", lineOp: 0.2 },
  emerald: { a: "#2A8A64", b: "#0F5039", c: "#072B1F", ink: "#FFFFFF", line: "#FFFFFF", lineOp: 0.14 },
} as const;
export const planInk = (t: PlanTone) => TONES[t].ink;

/** Textured gradient card, same family as the wallet cards on Home. Solid colour underneath, so it never shows a gap while it measures. */
export function PlanCard({ tone, children, onPress }: { tone: PlanTone; children: ReactNode; onPress?: () => void }) {
  const t = TONES[tone];
  const gid = `pc_${tone}`;
  const [box, setBox] = useState({ w: 0, h: 0 });
  const body = (
    <View onLayout={(e: LayoutChangeEvent) => setBox({ w: Math.round(e.nativeEvent.layout.width), h: Math.round(e.nativeEvent.layout.height) })}
      style={{ borderRadius: 26, overflow: "hidden", padding: 20, backgroundColor: t.b }}>
      {box.w > 0 ? (
        <Svg width={box.w} height={box.h} style={{ position: "absolute", left: 0, top: 0 }} pointerEvents="none">
          <Defs><LinearGradient id={gid} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={t.a} /><Stop offset="0.55" stopColor={t.b} /><Stop offset="1" stopColor={t.c} /></LinearGradient></Defs>
          <Rect width={box.w} height={box.h} fill={`url(#${gid})`} />
          <G transform={`translate(${box.w - 40} ${box.h + 30})`} stroke={t.line} strokeOpacity={t.lineOp} strokeWidth={1} fill="none">
            {[30, 46, 62, 78, 94, 110, 126].map((r) => <Circle key={r} r={r} />)}
          </G>
        </Svg>
      ) : null}
      {children}
    </View>
  );
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.93 : 1 })}>{body}</Pressable> : body;
}

/** Progress ring with a label in the middle. Static: redraws when `frac` changes, no animated values. */
export function Ring({ frac, size = 84, color, track, children }: { frac: number; size?: number; color: string; track: string; children?: ReactNode }) {
  const r = size / 2 - 7, C = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac));
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={8} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={8} strokeLinecap="round" fill="none" strokeDasharray={`${Math.round(C * f * 100) / 100} ${Math.round(C)}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </Svg>
      {children}
    </View>
  );
}

/** Row of small segments, filled for completed steps. */
export function Segments({ total, done, color, track }: { total: number; done: number; color: string; track: string }) {
  return <View style={{ flexDirection: "row", gap: 4 }}>{Array.from({ length: Math.min(total, 60) }, (_, i) => <View key={i} style={{ flex: 1, height: 7, borderRadius: 4, backgroundColor: i < done ? color : track }} />)}</View>;
}
