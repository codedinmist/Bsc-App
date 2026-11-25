import { countdown, formatAmount, groupIndian, parseAmount, E } from "../src/chain/format";

describe("amount formatting", () => {
  test("Indian digit grouping", () => {
    expect(groupIndian("1")).toBe("1");
    expect(groupIndian("1000")).toBe("1,000");
    expect(groupIndian("100000")).toBe("1,00,000");
    expect(groupIndian("12345678")).toBe("1,23,45,678");
  });
  test("formatAmount trims zeros and respects decimals", () => {
    expect(formatAmount(E(36500))).toBe("36,500");
    expect(formatAmount(E("1000.5"))).toBe("1,000.5");
    expect(formatAmount(E("0.000123"), 4)).toBe("0.0001");
    expect(formatAmount(0n)).toBe("0");
  });
  test("parseAmount accepts commas, rejects junk and over-precision", () => {
    expect(parseAmount("1,000.50")).toBe(E("1000.5"));
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
    expect(parseAmount("1.1234567890123456789")).toBeNull();
  });
  test("countdown", () => {
    expect(countdown(0)).toBe("now");
    expect(countdown(90)).toBe("1m");
    expect(countdown(3600 * 5 + 60 * 7)).toBe("5h 7m");
    expect(countdown(86400 * 2 + 3600 * 3)).toBe("2d 3h");
  });
});
