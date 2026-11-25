import { useEffect, useState } from "react";
import { AccessibilityInfo, Easing } from "react-native";

/**
 * Motion rules:
 *  - Built on React Native's own Animated with the native driver (opacity and transform only). No third-party animation engine,
 *    so nothing here can crash when a screen opens or a tab is tapped.
 *  - Springs are critically damped and never bounce. Timings 200-380 ms.
 *  - With "reduce motion" on, movement becomes instant.
 */
const critical = (stiffness: number, mass = 1) => ({
  stiffness, mass, damping: 2 * Math.sqrt(stiffness * mass), overshootClamping: true, useNativeDriver: true as const,
});

export const springs = {
  press: critical(520),
  sheet: critical(300),
  settle: critical(220),
  gentle: critical(140),
} as const;

export const ease = {
  out: Easing.bezier(0.2, 0, 0, 1),
  inOut: Easing.bezier(0.4, 0, 0.2, 1),
  in: Easing.bezier(0.3, 0, 0.8, 0.15),
} as const;

export const duration = { fast: 200, base: 280, slow: 380, digit: 520, draw: 420 } as const;

export function useMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (live) setReduce(!!v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => setReduce(!!v));
    return () => { live = false; sub.remove(); };
  }, []);
  return { reduce, d: (ms: number) => (reduce ? 1 : ms) };
}

/** Smooth number from its previous value to `target` (used for SVG strokes, which cannot use the native driver). */
export function useTween(target: number, ms: number): number {
  const [v, setV] = useState(0);
  const [from, setFrom] = useState(0);
  useEffect(() => {
    const a = from, b = target, t0 = Date.now();
    let raf = 0;
    const step = () => {
      const p = Math.min(1, (Date.now() - t0) / Math.max(1, ms));
      const e = 1 - Math.pow(1 - p, 3);
      setV(a + (b - a) * e);
      if (p < 1) raf = requestAnimationFrame(step); else setFrom(b);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ms]);
  return v;
}
