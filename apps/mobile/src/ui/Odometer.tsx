import { useEffect } from "react";
import { View, type TextStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useColors, type } from "@/design/tokens";
import { duration, ease, useMotion } from "@/design/motion";
import { T } from "./Text";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function Digit({ n, h, style }: { n: number; h: number; style: TextStyle }) {
  const { d } = useMotion();
  const y = useSharedValue(-n * h);
  useEffect(() => { y.value = withTiming(-n * h, { duration: d(duration.digit), easing: ease.out }); }, [n, h, d, y]);
  const col = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <View style={{ height: h, overflow: "hidden" }}>
      <Animated.View style={col}>
        {DIGITS.map((k) => (<T key={k} v="money" style={[style, { height: h }]}>{String(k)}</T>))}
      </Animated.View>
    </View>
  );
}

/** Balance that rolls digit by digit, like a mechanical counter. Pass an already formatted string. */
export function Odometer({ value, color = "text" }: { value: string; color?: "text" | "textOnPrimary" }) {
  const c = useColors();
  const h = type.money.lineHeight;
  const style: TextStyle = { color: c[color], fontVariant: ["tabular-nums"] };
  const chars = value.split("");
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end" }} accessible accessibilityLabel={value}>
      {chars.map((ch, i) => {
        const fromEnd = chars.length - i; // stable key: position from the right keeps digits aligned when length changes
        return /\d/.test(ch) ? <Digit key={`d${fromEnd}`} n={Number(ch)} h={h} style={style} /> : <T key={`s${fromEnd}`} v="money" style={style}>{ch}</T>;
      })}
    </View>
  );
}
