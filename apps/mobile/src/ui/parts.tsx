import { useEffect, type ReactNode } from "react";
import { Pressable, TextInput, View, type TextInputProps } from "react-native";
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { radius, space, useColors } from "@/design/tokens";
import { duration, ease, useMotion } from "@/design/motion";
import { T } from "./Text";
import { Icon, type IconName } from "./Icon";
import { Card } from "./Card";

/** Subtle staggered entrance: 8px rise + fade, decelerating. */
export const rise = (i = 0) => FadeInDown.delay(Math.min(i, 8) * 45).duration(duration.base).easing(ease.out).withInitialValues({ transform: [{ translateY: 8 }] });

export function Section({ title, children, index = 0 }: { title?: string; children: ReactNode; index?: number }) {
  return (
    <Animated.View entering={rise(index)} style={{ marginBottom: space.xl, gap: space.md }}>
      {title ? <T v="caption" color="textSecondary" style={{ marginLeft: 4, letterSpacing: 1.3, textTransform: "uppercase" }}>{title}</T> : null}
      {children}
    </Animated.View>
  );
}

export function Row({ icon, title, subtitle, right, onPress, last }: { icon?: IconName; title: string; subtitle?: string; right?: ReactNode; onPress?: () => void; last?: boolean }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "button" : undefined}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 14, paddingHorizontal: space.lg, backgroundColor: pressed ? c.surfaceAlt : "transparent", borderBottomWidth: last ? 0 : 1, borderBottomColor: c.hairline })}>
      {icon ? <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: c.tint, alignItems: "center", justifyContent: "center" }}><Icon name={icon} size={20} color={c.primary} /></View> : null}
      <View style={{ flex: 1 }}>
        <T v="callout">{title}</T>
        {subtitle ? <T v="footnote" color="textSecondary">{subtitle}</T> : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron" size={18} color={c.textSecondary} /> : null)}
    </Pressable>
  );
}

export function List({ children }: { children: ReactNode }) {
  return <Card padded={false} style={{ overflow: "hidden" }}>{children}</Card>;
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <T v="footnote" color="textSecondary">{label}</T>
      <T v="headline" style={{ fontVariant: ["tabular-nums"] }}>{value}</T>
      {hint ? <T v="caption" color="textSecondary">{hint}</T> : null}
    </View>
  );
}

export function Banner({ kind = "info", title, body }: { kind?: "info" | "warning" | "error"; title: string; body?: string }) {
  const c = useColors();
  const bg = kind === "error" ? c.errorTint : kind === "warning" ? c.warningTint : c.tint;
  const fg = kind === "error" ? c.error : kind === "warning" ? c.warning : c.tintText;
  return (
    <View style={{ backgroundColor: bg, borderRadius: 22, padding: space.lg, flexDirection: "row", gap: space.md }} accessibilityRole="alert">
      <Icon name={kind === "info" ? "info" : "alert"} size={20} color={fg} />
      <View style={{ flex: 1, gap: 2 }}>
        <T v="callout" style={{ color: fg }}>{title}</T>
        {body ? <T v="footnote" style={{ color: fg }}>{body}</T> : null}
      </View>
    </View>
  );
}

export function Segmented<V extends string | number>({ options, value, onChange }: { options: { label: string; value: V }[]; value: V; onChange: (v: V) => void }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", backgroundColor: c.surfaceAlt, borderRadius: 999, padding: 4, gap: 4 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={String(o.value)} onPress={() => onChange(o.value)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={{ flex: 1, paddingVertical: 10, borderRadius: 999, alignItems: "center", backgroundColor: on ? c.primary : "transparent" }}>
            <T v="callout" style={{ color: on ? c.textOnPrimary : c.textSecondary }}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

export function AmountInput(props: TextInputProps & { suffix?: string }) {
  const c = useColors();
  const { suffix, style, ...rest } = props;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: c.surfaceAlt, borderRadius: 20, paddingHorizontal: space.lg, minHeight: 58 }}>
      <TextInput keyboardType="decimal-pad" placeholderTextColor={c.textSecondary} {...rest}
        style={[{ flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 22, color: c.text, fontVariant: ["tabular-nums"] }, style]} />
      {suffix ? <T v="callout" color="textSecondary">{suffix}</T> : null}
    </View>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const c = useColors();
  const v = Math.max(0, Math.min(1, value));
  return (
    <View style={{ height: 10, borderRadius: 5, backgroundColor: c.surfaceAlt, overflow: "hidden" }}>
      <View style={{ height: 10, borderRadius: 5, backgroundColor: c.emerald, width: `${Math.round(v * 10000) / 100}%` }} />
    </View>
  );
}
