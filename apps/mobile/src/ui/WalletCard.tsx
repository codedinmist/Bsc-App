import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { duration, ease, springs, useMotion } from "@/design/motion";
import { T } from "./Text";
import { Logo } from "./Logo";

export type CardTone = "fixed" | "recurring" | "daily" | "balance";
export const TONES: Record<CardTone, { a: string; b: string; fg: string; sub: string; edge: string }> = {
  fixed: { a: "#FFFFFF", b: "#DDEBE3", fg: "#10261B", sub: "#52665B", edge: "rgba(16,38,27,0.10)" },
  recurring: { a: "#34C2AE", b: "#0B7468", fg: "#FFFFFF", sub: "#D3F3EE", edge: "rgba(255,255,255,0.22)" },
  daily: { a: "#A6EBC9", b: "#4FC08F", fg: "#093A26", sub: "#1D5A41", edge: "rgba(255,255,255,0.35)" },
  balance: { a: "#10A56C", b: "#033A25", fg: "#FFFFFF", sub: "#C7EBD9", edge: "rgba(255,255,255,0.20)" },
};

export const CARD_H = 212;
export const PEEK = 66; // visible strip of a card that sits behind another
export const CARD_RADIUS = 26;

/**
 * One Wallet-style pass.
 * Rendering notes (Android): no `elevation` and no transparent-background shadows (they draw grey boxes),
 * and the gradient is drawn at the measured pixel size (percentage-sized SVGs came out narrower than the card).
 * The soft shadow a card casts on the one behind it is painted inside the back card, at the bottom of its visible strip.
 */
export function WalletCard({ tone, title, amount, caption, detail, index, slot = index, onPress, front }: { tone: CardTone; title: string; amount: string; caption: string; detail?: string; index: number; slot?: number; onPress: () => void; front?: boolean }) {
  const t = TONES[tone];
  const { reduce } = useMotion();
  // Motion: a card slides to its slot on a critically damped spring (no bounce) and lifts a few pixels while pressed.
  const pos = useSharedValue(slot);
  const lift = useSharedValue(0);
  useEffect(() => { pos.value = reduce ? withTiming(slot, { duration: 1 }) : withSpring(slot, springs.gentle); }, [slot, reduce, pos]);
  const motion = useAnimatedStyle(() => ({ top: pos.value * PEEK, transform: [{ translateY: -lift.value * 7 }, { scale: 1 + lift.value * 0.012 }] }));
  const id = `wc-${tone}`;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - size.w) > 0.5 || Math.abs(height - size.h) > 0.5) setSize({ w: width, h: height });
  };
  const { w, h } = size;

  return (
    <Animated.View style={[{ position: "absolute", left: 0, right: 0, height: CARD_H, zIndex: slot }, motion]}>
      <Animated.View
        entering={FadeInDown.delay(index * 70).duration(duration.slow).easing(ease.out).withInitialValues({ transform: [{ translateY: 24 }] })}
        style={{ flex: 1 }}
      >
      <View onLayout={onLayout} style={{ flex: 1, borderRadius: CARD_RADIUS, overflow: "hidden", backgroundColor: t.b, borderWidth: StyleSheet.hairlineWidth, borderColor: t.edge }}>
        {w > 0 && (
          <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
            <Defs>
              <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={t.a} /><Stop offset="1" stopColor={t.b} /></LinearGradient>
              <LinearGradient id={`${id}-gloss`} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#FFF" stopOpacity="0.20" /><Stop offset="0.55" stopColor="#FFF" stopOpacity="0" /></LinearGradient>
              <LinearGradient id={`${id}-cast`} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#000" stopOpacity="0" /><Stop offset="1" stopColor="#000" stopOpacity="0.16" /></LinearGradient>
            </Defs>
            <Rect x="0" y="0" width={w} height={h} fill={`url(#${id})`} />
            <Circle cx={w * 0.9} cy={-h * 0.08} r={h * 0.55} fill={t.fg} opacity={0.06} />
            <Circle cx={w * 1.02} cy={h * 0.32} r={h * 0.34} fill={t.fg} opacity={0.05} />
            <Rect x="0" y="0" width={w} height={h * 0.6} fill={`url(#${id}-gloss)`} />
            {!front && <Rect x="0" y={PEEK - 30} width={w} height={30} fill={`url(#${id}-cast)`} />}
          </Svg>
        )}
        <Pressable
          onPressIn={() => { lift.value = reduce ? 0 : withSpring(1, springs.press); }}
          onPressOut={() => { lift.value = withTiming(0, { duration: 180, easing: ease.out }); }}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
          accessibilityRole="button" accessibilityLabel={`${title}, ${amount} tINR`}
          style={{ flex: 1, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 18 }}
        >
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 9 }}>
              <Logo size={24} color={t.fg} />
              <T v="headline" numberOfLines={1} style={{ color: t.fg, flexShrink: 1 }}>{title}</T>
            </View>
            {front ? (
              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.16)" }}>
                <T v="caption" style={{ color: t.fg }}>TESTNET</T>
              </View>
            ) : (
              <T v="headline" numberOfLines={1} style={{ color: t.fg, fontVariant: ["tabular-nums"], marginLeft: 12 }}>{amount}</T>
            )}
          </View>
          {front && (
            <Animated.View entering={FadeIn.delay(140).duration(duration.base)} style={{ marginTop: "auto" }}>
              <T v="footnote" style={{ color: t.sub, marginBottom: 2 }}>{caption}</T>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                <T v="money" numberOfLines={1} adjustsFontSizeToFit style={{ color: t.fg, fontVariant: ["tabular-nums"], flexShrink: 1 }}>{amount}</T>
                <T v="headline" style={{ color: t.sub }}>tINR</T>
              </View>
              {detail ? <T v="footnote" numberOfLines={1} style={{ color: t.sub, marginTop: 4 }}>{detail}</T> : null}
            </Animated.View>
          )}
        </Pressable>
      </View>
      </Animated.View>
    </Animated.View>
  );
}
