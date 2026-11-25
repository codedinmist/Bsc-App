jest.mock("react-native-reanimated", () => ({ Easing: { bezier: () => () => 0 }, useReducedMotion: () => false }));
import { springs } from "../src/design/motion";

describe("motion rules", () => {
  test.each(Object.entries(springs))("%s spring is critically damped and clamped (no bounce)", (_name, s) => {
    expect(s.damping).toBeCloseTo(2 * Math.sqrt(s.stiffness * s.mass), 6);
    expect(s.overshootClamping).toBe(true);
  });
});
