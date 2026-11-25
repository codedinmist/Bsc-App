import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, View, type LayoutChangeEvent } from "react-native";
import * as Haptics from "expo-haptics";
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { springs, useMotion } from "@/design/motion";
import { useColors } from "@/design/tokens";
import { T } from "./Text";
import { CountUp } from "./CountUp";
import { Icon } from "./Icon";
import { copyTemporarily } from "@/lib/clipboard";

export type StackCard = { key: string; kind: "wallet" | "gold" | "green"; title: string; amount: number; sub: string; caption: string; copy?: string; onOpen?: () => void };

const CH = 150;          // card height
const PEEK = 30;         // how much of each back card shows
const W = 354, H = 146;  // pocket artwork size

const THEME = {
  wallet: { a: "#2A8A64", b: "#0F5039", c: "#072B1F", ink: "#FFFFFF", line: "#FFFFFF", lineOp: 0.16 },
  green: { a: "#7DB594", b: "#3C7A5F", c: "#1F4F3B", ink: "#FFFFFF", line: "#FFFFFF", lineOp: 0.2 },
  gold: { a: "#F0D690", b: "#C99E45", c: "#6E4D16", ink: "#2C1C05", line: "#5A3F10", lineOp: 0.42 },
} as const;

function Emblem({ color, size = 34 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none" stroke={color} strokeLinecap="round">
      <Path d="M12 82V68A38 38 0 0 1 88 68V82" strokeWidth={7} />
      <Path d="M8 88h84" strokeWidth={4} />
      <Path d="M24 70V80M37 56V80M50 52V80M63 56V80M76 70V80" strokeWidth={5} />
    </Svg>
  );
}

function Face({ kind, w }: { kind: StackCard["kind"]; w: number }) {
  const t = THEME[kind];
  const id = `g_${kind}`;
  return (
    <Svg width={w} height={CH} style={{ position: "absolute", left: 0, top: 0 }}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={t.a} /><Stop offset="0.55" stopColor={t.b} /><Stop offset="1" stopColor={t.c} />
        </LinearGradient>
      </Defs>
      <Rect width={w} height={CH} rx={22} fill={`url(#${id})`} />
      {kind === "gold" ? (
        <G opacity={0.5} stroke="#6b4a12" strokeWidth={0.7} fill="none" transform={`translate(${w - 78} 96)`}>
          {Array.from({ length: 18 }, (_, i) => <Ellipse key={i} cx={0} cy={0} rx={84} ry={27} transform={`rotate(${i * 10})`} />)}
        </G>
      ) : kind === "green" ? (
        <G stroke="#fff" strokeOpacity={t.lineOp} strokeWidth={0.8}>
          {Array.from({ length: 24 }, (_, i) => <Path key={i} d={`M${-20 + i * 16} 190L${150 + i * 16} -20`} />)}
        </G>
      ) : (
        <G stroke="#fff" strokeOpacity={0.16} strokeWidth={1} fill="none" transform={`translate(${w - 40} 190)`}>
          {[30, 48, 66, 84, 102, 120, 138].map((r) => <Circle key={r} r={r} />)}
        </G>
      )}
      <Rect width={w} height={1} fill="#fff" opacity={0.5} />
    </Svg>
  );
}

function CardView({ card, depth, n, w, front, onPress }: { card: StackCard; depth: number; n: number; w: number; front: boolean; onPress: () => void }) {
  const { reduce } = useMotion();
  const t = THEME[card.kind];
  const d = useRef(new Animated.Value(depth)).current;
  const enter = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => { if (reduce) d.setValue(depth); else Animated.spring(d, { toValue: depth, ...springs.settle }).start(); }, [depth, reduce, d]);
  useEffect(() => {
    if (reduce) { enter.setValue(1); return; }
    Animated.sequence([Animated.delay(120 + (n - 1 - depth) * 70), Animated.spring(enter, { toValue: 1, ...springs.gentle })]).start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const st = {
    opacity: enter,
    transform: [
      { translateY: Animated.add(d.interpolate({ inputRange: [0, 4], outputRange: [(n - 1) * PEEK, (n - 5) * PEEK] }), enter.interpolate({ inputRange: [0, 1], outputRange: [60, 0] })) },
      { scale: d.interpolate({ inputRange: [0, 4], outputRange: [1, 0.88] }) },
    ],
  };
  return (
    <Animated.View style={[{ position: "absolute", left: 0, top: 0, width: w, height: CH, zIndex: 10 - depth, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3 }, st]}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${card.title}, ${card.sub}`} style={{ flex: 1 }}>
        <Face kind={card.kind} w={w} />
        <View style={{ paddingHorizontal: 18, paddingTop: 11, flexDirection: "row", justifyContent: "space-between" }}>
          <T v="callout" style={{ color: t.ink, fontFamily: "Inter_600SemiBold" }}>{card.title}</T>
          <T v="callout" style={{ color: t.ink, fontFamily: card.kind === "wallet" ? "Inter_500Medium" : "Lora_500Medium", fontVariant: ["tabular-nums"] }}>{card.caption}</T>
        </View>
        {front ? (
          <>
            <View style={{ position: "absolute", right: 16, bottom: 52, opacity: 0.7 }}><Emblem color={t.ink} /></View>
          </>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

/** Wallet in a leather pocket with cards you can bring forward. Uses only transforms and opacity (safe on every Android). */
export function WalletStack({ cards, loaded, format }: { cards: StackCard[]; loaded: boolean; format: (n: number) => string }) {
  const c = useColors();
  const { reduce } = useMotion();
  const [w, setW] = useState(0);
  const [order, setOrder] = useState(cards.map((x) => x.key)); // order[0] is in front
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 1800); return () => clearTimeout(t); }, [copied]);
  const doCopy = (text: string) => { Haptics.selectionAsync().catch(() => {}); copyTemporarily(text).then(() => setCopied(true)).catch(() => {}); };
  const onLayout = (e: LayoutChangeEvent) => setW(Math.round(e.nativeEvent.layout.width));
  const n = cards.length;
  const front = cards.find((x) => x.key === order[0]) ?? cards[0];
  const pocketH = w ? (w * H) / W : 150;
  const stackH = (n - 1) * PEEK + CH;
  const pocketTop = (n - 1) * PEEK + 54;
  const total = pocketTop + pocketH + 6;
  const pick = (k: string) => { if (k === order[0]) return; Haptics.selectionAsync().catch(() => {}); setOrder([k, ...order.filter((o) => o !== k)]); };
  const pop = useRef(new Animated.Value(1)).current;
  useEffect(() => { if (reduce) { pop.setValue(1); return; } pop.setValue(0.92); Animated.timing(pop, { toValue: 1, duration: 260, useNativeDriver: true }).start(); }, [front.key, reduce, pop]);
  const labelStyle = { opacity: pop, transform: [{ translateY: pop.interpolate({ inputRange: [0.92, 1], outputRange: [40 * 0.08, 0], extrapolate: "clamp" }) }] };
  const amountText = format(front.amount);
  const L = amountText.length;
  const size = L <= 5 ? 40 : L <= 7 ? 35 : L <= 9 ? 30 : 26;

  return (
    <View>
      <View onLayout={onLayout} style={{ height: total }}>
        {w > 0 && (
          <>
            <View style={{ position: "absolute", left: 14, right: 14, top: 0, height: stackH }}>
              {cards.map((cd) => <CardView key={cd.key} card={cd} depth={order.indexOf(cd.key)} n={n} w={w - 28} front={cd.key === order[0]} onPress={() => (cd.key === order[0] ? cd.onOpen?.() : pick(cd.key))} />)}
            </View>
            <View style={{ position: "absolute", left: 0, top: pocketTop, width: w, height: pocketH, zIndex: 20 }} pointerEvents="box-none">
              <Svg width={w} height={pocketH} viewBox={`0 0 ${W} ${H}`} pointerEvents="none">
                <Defs><LinearGradient id="pk" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#24342C" /><Stop offset="1" stopColor="#101A15" /></LinearGradient></Defs>
                <Path d="M0 26Q0 12 14 12H118C146 12 158 44 177 44S208 12 236 12H340Q354 12 354 26V122Q354 146 330 146H24Q0 146 0 122Z" fill="url(#pk)" />
                <Path d="M12 30Q12 22 20 22H118C148 22 160 54 177 54S206 22 236 22H334Q342 22 342 30V120Q342 134 328 134H26Q12 134 12 120Z" fill="none" stroke="#B08A3E" strokeOpacity={0.75} strokeWidth={1.3} strokeDasharray="5 4" />
              </Svg>
              <Animated.View style={[{ position: "absolute", left: 28, bottom: 24, right: 28 }, labelStyle]} pointerEvents="box-none">
                <T v="footnote" style={{ color: "rgba(255,255,255,0.72)" }}>{front.title === "Wallet" ? "Wallet balance" : front.title}</T>
                <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6 }}>
                  {loaded ? <CountUp value={front.amount} format={format} ms={900} style={{ color: "#fff", fontSize: size, lineHeight: size + 8, letterSpacing: -0.8, fontFamily: "Lora_500Medium" }} /> : <T v="money" style={{ color: "#fff", fontSize: 34 }}>…</T>}
                  <T v="callout" style={{ color: "rgba(255,255,255,0.78)", marginBottom: 5 }}>tINR</T>
                </View>
                {front.copy ? (
                  <Pressable onPress={() => doCopy(front.copy!)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Copy wallet address" style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" }}>
                    <T v="footnote" style={{ color: "rgba(255,255,255,0.62)" }} numberOfLines={1}>{copied ? "Address copied" : front.sub}</T>
                    <Icon name={copied ? "check" : "copy"} size={14} color="rgba(255,255,255,0.8)" />
                  </Pressable>
                ) : <T v="footnote" style={{ color: "rgba(255,255,255,0.62)" }} numberOfLines={1}>{front.sub}</T>}
              </Animated.View>
              <View style={{ position: "absolute", right: 26, top: 38 }}>
                {front.kind === "wallet" ? (
                  <View style={{ borderWidth: 1, borderColor: "#B08A3E", borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 }}><T v="caption" style={{ color: "#D9B867", letterSpacing: 1.2 }}>TESTNET</T></View>
                ) : front.onOpen ? (
                  <Pressable onPress={front.onOpen} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Open ${front.title}`} style={{ backgroundColor: "#FAF6EC", borderRadius: 99, paddingHorizontal: 14, paddingVertical: 8 }}><T v="caption" style={{ color: "#0A3D2C", fontFamily: "Inter_700Bold" }}>Open ›</T></Pressable>
                ) : null}
              </View>
            </View>
          </>
        )}
      </View>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
        {cards.map((cd) => {
          const on = cd.key === order[0];
          const dot = cd.kind === "gold" ? "#B08A3E" : cd.kind === "green" ? "#3C7A5F" : "#0F5039";
          return (
            <Pressable key={cd.key} onPress={() => pick(cd.key)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`Show ${cd.title}`}
              style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 99, backgroundColor: on ? c.text : c.surface, borderWidth: 1, borderColor: on ? c.text : c.border }}>
              <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: dot }} />
              <T v="caption" style={{ color: on ? c.bg : c.text, fontFamily: "Inter_600SemiBold" }}>{cd.title.split(" ")[0]}</T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
