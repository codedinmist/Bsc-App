import { useEffect, useRef } from "react";
import { Animated, type DimensionValue } from "react-native";
import { radius, useColors } from "@/design/tokens";
import { ease, useMotion } from "@/design/motion";

/** Slow, soft shimmer. The only looping animation in the app. */
export function Skeleton({ width = "100%", height = 16 }: { width?: DimensionValue; height?: number }) {
  const c = useColors();
  const { reduce } = useMotion();
  const o = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(o, { toValue: 1, duration: 1400, easing: ease.inOut, useNativeDriver: true }),
      Animated.timing(o, { toValue: 0.55, duration: 1400, easing: ease.inOut, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduce, o]);
  return <Animated.View style={{ width, height, borderRadius: radius.sm, backgroundColor: c.surfaceAlt, opacity: o }} />;
}
