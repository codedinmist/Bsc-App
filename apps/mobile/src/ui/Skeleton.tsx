import { useEffect } from "react";
import { type DimensionValue } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { radius, useColors } from "@/design/tokens";
import { ease, useMotion } from "@/design/motion";

/** Slow, soft shimmer. The only looping animation in the app. */
export function Skeleton({ width = "100%", height = 16 }: { width?: DimensionValue; height?: number }) {
  const c = useColors();
  const { reduce } = useMotion();
  const o = useSharedValue(0.55);
  useEffect(() => { if (!reduce) o.value = withRepeat(withTiming(1, { duration: 1400, easing: ease.inOut }), -1, true); }, [reduce, o]);
  const s = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width, height, borderRadius: radius.sm, backgroundColor: c.surfaceAlt }, s]} />;
}
