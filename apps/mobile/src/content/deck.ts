/**
 * Figures proposed in the JANSETU master pitch deck (slides 3 and 4). They are PROJECTIONS ONLY, shown with a
 * "Projected" label. No contract guarantees them; real rewards are paid only from funded reward pools.
 */
export const DECK_DAILY = [
  { daily: 50, deposited: 18250, projected: 20000 },
  { daily: 100, deposited: 36500, projected: 40000 },
  { daily: 200, deposited: 73000, projected: 80000 },
  { daily: 500, deposited: 182500, projected: 200000 },
] as const;

export const DECK_RD = [
  { monthly: 1000, years: 1, apy: 18, deposited: 12000, projected: 13140 },
  { monthly: 2000, years: 3, apy: 21, deposited: 72000, projected: 97917 },
  { monthly: 3000, years: 5, apy: 24, deposited: 180000, projected: 326174 },
  { monthly: 5000, years: 5, apy: 24, deposited: 300000, projected: 543623 },
] as const;

export const DECK_FD = [
  { amount: 25000, y1: 30000, y2: 36906, y3: 46522 },
  { amount: 50000, y1: 60000, y2: 73811, y3: 93043 },
  { amount: 100000, y1: 120000, y2: 147622, y3: 186087 },
  { amount: 500000, y1: 600000, y2: 738113, y3: 930433 },
] as const;
export const DECK_FD_RATES = { 1: "20%", 2: "21.5%", 3: "23%" } as const;

export const projectedDaily = (daily: number) => DECK_DAILY.find((r) => r.daily === daily);
export const projectedRd = (monthly: number, years: number) => DECK_RD.find((r) => r.monthly === monthly && r.years === years);
export function projectedFd(amount: number, years: 1 | 2 | 3) {
  const row = DECK_FD.find((r) => r.amount === amount);
  return row ? row[`y${years}` as "y1" | "y2" | "y3"] : undefined;
}
