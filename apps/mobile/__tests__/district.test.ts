import { crore, DECK_DISTRICT, DECK_INPUTS, districtModel } from "../src/lib/district";

describe("district P&L model (deck slide 13)", () => {
  test("the deck's inputs reproduce the deck's own figures", () => {
    const m = districtModel(DECK_INPUTS);
    expect(m.tvl).toBeCloseTo(DECK_DISTRICT.tvlCr, 6);
    expect(m.gross).toBeCloseTo(DECK_DISTRICT.grossCr, 6);
    expect(m.customer).toBeCloseTo(DECK_DISTRICT.customerCr, 6);
    expect(m.network).toBeCloseTo(DECK_DISTRICT.networkCr, 6);
    expect(m.ops).toBeCloseTo(DECK_DISTRICT.opsCr, 6);
    expect(m.surplus).toBeCloseTo(DECK_DISTRICT.surplusCr, 6);
  });
  test("the deck's own rows add up (revenue - payouts - commissions - costs = surplus)", () => {
    const d = DECK_DISTRICT;
    expect(d.grossCr - d.customerCr - d.networkCr - d.opsCr).toBeCloseTo(d.surplusCr, 6);
  });
  test("half the agents gives half of everything in a straight line", () => {
    const m = districtModel({ ...DECK_INPUTS, agents: 50 });
    expect(m.surplus).toBeCloseTo(DECK_DISTRICT.surplusCr / 2, 6);
  });
  test("lower revenue can turn the surplus into a loss, and zero agents give zero", () => {
    expect(districtModel({ ...DECK_INPUTS, grossPct: 15 }).surplus).toBeLessThan(0);
    expect(districtModel({ ...DECK_INPUTS, agents: 0 })).toMatchObject({ tvl: 0, gross: 0, surplus: 0, margin: 0 });
  });
  test("crore formatting", () => { expect(crore(3.2)).toBe("₹3.20 Cr"); expect(crore(72.5)).toBe("₹72.50 Cr"); });
});
