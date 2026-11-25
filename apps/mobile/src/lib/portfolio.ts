import type { RawPosition } from "@/chain/DataProvider";

export const active = (xs: RawPosition[]) => xs.filter((p) => p.status === 1);
export const sumPrincipal = (xs: RawPosition[]) => active(xs).reduce((a, p) => a + p.principal, 0n);
export function nextMaturity(...lists: RawPosition[][]): number | null {
  const all = lists.flatMap(active).map((p) => Number(p.maturityAt));
  return all.length ? Math.min(...all) : null;
}
