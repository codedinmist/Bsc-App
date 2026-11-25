import { useEffect, useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { springs, useMotion } from "@/design/motion";
import { T } from "./Text";
import { CountUp } from "./CountUp";

const W = 354, H = 146;

/** Wallet card sitting in a leather pocket. The card slides up out of the pocket when the screen opens. */
export function PocketCard({ balance, format, address, loaded }: { balance: number; format: (n: number) => string; address?: string; loaded: boolean }) {
  const { reduce } = useMotion();
  const [w, setW] = useState(0);
  const y = useSharedValue(reduce ? 0 : 70);
  const o = useSharedValue(reduce ? 1 : 0);
  useEffect(() => { y.value = reduce ? 0 : withDelay(150, withSpring(0, springs.gentle)); o.value = withDelay(150, withTiming(1, { duration: 260 })); }, [reduce, y, o]);
  const card = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: y.value }] }));
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const ph = w ? (w * H) / W : 150;
  return (
    <View onLayout={onLayout} style={{ height: ph + 60 }}>
      <Animated.View style={[{ position: "absolute", left: 14, right: 14, top: 4, height: 126, borderRadius: 22, backgroundColor: "#157148", padding: 15, overflow: "hidden" }, card]}>
        <View style={{ position: "absolute", right: -30, top: -40, width: 150, height: 150, borderRadius: 75, borderWidth: 22, borderColor: "rgba(255,255,255,0.08)" }} />
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <T v="callout" style={{ color: "#fff", fontFamily: "DMSans_700Bold" }}>JanSetu wallet</T>
          <T v="caption" style={{ color: "rgba(255,255,255,0.85)" }}>{address ? `${address.slice(0, 6)}…${address.slice(-4)}` : ""}</T>
        </View>
        <T v="caption" style={{ color: "rgba(255,255,255,0.8)", marginTop: 8 }}>TEST MONEY · tINR</T>
      </Animated.View>
      {w > 0 && (
        <View style={{ position: "absolute", left: 0, top: 54, width: w, height: ph }} pointerEvents="none">
          <Svg width={w} height={ph} viewBox={`0 0 ${W} ${H}`}>
            <Path d="M0 26Q0 12 14 12H118C146 12 158 44 177 44S208 12 236 12H340Q354 12 354 26V122Q354 146 330 146H24Q0 146 0 122Z" fill="#0F2F22" />
            <Path d="M12 30Q12 22 20 22H118C148 22 160 54 177 54S206 22 236 22H334Q342 22 342 30V120Q342 134 328 134H26Q12 134 12 120Z" fill="none" stroke="#3E6B55" strokeWidth={1.4} strokeDasharray="5 4" />
          </Svg>
          <View style={{ position: "absolute", left: 30, bottom: 24 }}>
            <T v="footnote" style={{ color: "rgba(255,255,255,0.75)" }}>Wallet balance</T>
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6 }}>
              {loaded ? <CountUp value={balance} format={format} style={{ color: "#fff", fontSize: 30, lineHeight: 38, letterSpacing: -0.9 }} /> : <T v="money" style={{ color: "#fff", fontSize: 30, lineHeight: 38 }}>…</T>}
              <T v="callout" style={{ color: "rgba(255,255,255,0.8)", marginBottom: 5 }}>tINR</T>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
