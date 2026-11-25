import { DECK_DAILY, DECK_FD, DECK_RD, projectedFd } from "../src/content/deck";

describe("deck figures stay internally consistent (they are projections, not guarantees)", () => {
  test("daily: deposited = daily x 365", () => { for (const r of DECK_DAILY) expect(r.deposited).toBe(r.daily * 365); });
  test("rd: deposited = monthly x 12 x years", () => { for (const r of DECK_RD) expect(r.deposited).toBe(r.monthly * 12 * r.years); });
  test("fd: matches 20% / 21.5% / 23% compounding within 1 rupee", () => {
    for (const r of DECK_FD) {
      expect(Math.abs(r.y1 - r.amount * 1.2)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.y2 - r.amount * 1.215 ** 2)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.y3 - r.amount * 1.23 ** 3)).toBeLessThanOrEqual(1);
    }
  });
  test("lookup", () => { expect(projectedFd(25000, 1)).toBe(30000); expect(projectedFd(123, 1)).toBeUndefined(); });
});
