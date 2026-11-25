import { useEffect, useState } from "react";
import Svg, { Circle, Path } from "react-native-svg";
import { useMotion } from "@/design/motion";

const GOLD = "#B08A3E";
const clamp = (x: number) => Math.max(0, Math.min(1, x));

/** JanSetu mark: a bridge arch on five pillars with a gold keystone. With `animated` it builds up piece by piece, driven by a plain timer (no native animation engine). */
export function Logo({ size = 40, color, plain = false, animated = false }: { size?: number; color?: string; plain?: boolean; animated?: boolean }) {
  const { reduce } = useMotion();
  const run = animated && !reduce;
  const [t, setT] = useState(run ? 0 : 2000);
  useEffect(() => {
    if (!run) { setT(2000); return; }
    const t0 = Date.now(); let id = 0;
    const tick = () => { const e = Date.now() - t0; setT(e); if (e < 1600) id = setTimeout(tick, 40) as unknown as number; };
    id = setTimeout(tick, 40) as unknown as number;
    return () => clearTimeout(id);
  }, [run]);
  const ink = color ?? (plain ? "#FFFFFF" : "#0A3D2C");
  const op = (start: number) => (run ? clamp((t - start) / 380) : 1);
  const pillars = ["M24 70V82", "M37 56V82", "M50 50V82", "M63 56V82", "M76 70V82"];
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="JanSetu">
      <Path d="M12 82V68A38 38 0 0 1 88 68V82" stroke={ink} strokeWidth={7} strokeLinecap="round" fill="none" opacity={op(0)} />
      {pillars.map((d, i) => <Path key={d} d={d} stroke={ink} strokeWidth={5} strokeLinecap="round" fill="none" opacity={op(350 + i * 120)} />)}
      <Path d="M8 89h84" stroke={ink} strokeWidth={4} strokeLinecap="round" fill="none" opacity={op(900)} />
      <Circle cx={50} cy={19} r={5} fill={plain ? "#E3C77A" : GOLD} opacity={op(1050)} />
    </Svg>
  );
}
