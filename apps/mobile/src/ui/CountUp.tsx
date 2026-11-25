import { useEffect, useRef, useState } from "react";
import { T } from "./Text";
import { useMotion } from "@/design/motion";
import type { TextStyle } from "react-native";

/** Number that counts up to its value with an ease-out curve. Shows the final value at once when reduce-motion is on. */
export function CountUp({ value, format, style, ms = 1100 }: { value: number; format: (n: number) => string; style?: TextStyle; ms?: number }) {
  const { reduce } = useMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const from = useRef(reduce ? value : 0);
  useEffect(() => {
    if (reduce) { setShown(value); from.current = value; return; }
    const a = from.current, b = value, t0 = Date.now();
    let raf = 0;
    const step = () => {
      const p = Math.min(1, (Date.now() - t0) / ms);
      const e = 1 - Math.pow(1 - p, 4);
      const v = a + (b - a) * e;
      setShown(v); from.current = v;
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduce, ms]);
  return <T v="money" style={{ fontVariant: ["tabular-nums"], ...style }}>{format(shown)}</T>;
}
