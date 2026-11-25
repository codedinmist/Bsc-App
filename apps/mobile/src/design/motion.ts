import { Easing, useReducedMotion } from "react-native-reanimated";

/**
 * Motion rules (see docs/DESIGN.md):
 *  - Springs are critically damped (damping = 2*sqrt(stiffness*mass)) and overshootClamping is on: they settle, never bounce.
 *  - Timings 200-380 ms. Entering = decelerate, leaving = accelerate.
 *  - Every animation explains a change of state. Nothing loops except loading shimmer.
 *  - With "reduce motion" on, movement becomes a short fade.
 */
const critical = (stiffness: number, mass = 1) => ({
  stiffness, mass, damping: 2 * Math.sqrt(stiffness * mass), overshootClamping: true,
});

export const springs = {
  press: critical(520),   // tactile response
  sheet: critical(300),   // bottom sheets
  settle: critical(220),  // layout settling
  gentle: critical(140),  // large moves
} as const;

export const ease = {
  out: Easing.bezier(0.2, 0, 0, 1),      // emphasised decelerate
  inOut: Easing.bezier(0.4, 0, 0.2, 1),  // standard
  in: Easing.bezier(0.3, 0, 0.8, 0.15),  // accelerate
} as const;

export const duration = { fast: 200, base: 280, slow: 380, digit: 520, draw: 420 } as const;

export function useMotion() {
  const reduce = useReducedMotion();
  return { reduce, d: (ms: number) => (reduce ? 1 : ms) };
}
