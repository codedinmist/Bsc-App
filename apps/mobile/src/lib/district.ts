/**
 * District P&L model (deck slide 13). The deck gives one district of 100 agents; this scales it so a presenter can ask
 * "what if 60 agents?" or "what if deposits are lower?". It is a PROJECTION from the deck, not a promise, and not independent financial modelling.
 * All amounts are in crore rupees (1 crore = 10,000,000).
 */
export const DECK_DISTRICT = { agents: 100, tvlCr: 72.5, grossCr: 21.6, customerCr: 11.2, networkCr: 6.35, opsCr: 0.85, surplusCr: 3.2 } as const;

export type DistrictInputs = {
  agents: number;
  tvlPerAgentCr: number;   // yearly fund inflow per agent
  grossPct: number;        // gross revenue as % of TVL
  customerPct: number;     // customer returns and bonuses as % of TVL
  networkPct: number;      // commissions, bonuses and rewards as % of TVL
  opsPerAgentCr: number;   // technology, audit, insurance and operations per agent
};

export const DECK_INPUTS: DistrictInputs = {
  agents: DECK_DISTRICT.agents,
  tvlPerAgentCr: DECK_DISTRICT.tvlCr / DECK_DISTRICT.agents,
  grossPct: (DECK_DISTRICT.grossCr / DECK_DISTRICT.tvlCr) * 100,
  customerPct: (DECK_DISTRICT.customerCr / DECK_DISTRICT.tvlCr) * 100,
  networkPct: (DECK_DISTRICT.networkCr / DECK_DISTRICT.tvlCr) * 100,
  opsPerAgentCr: DECK_DISTRICT.opsCr / DECK_DISTRICT.agents,
};

export function districtModel(i: DistrictInputs) {
  const tvl = i.agents * i.tvlPerAgentCr;
  const gross = tvl * (i.grossPct / 100);
  const customer = tvl * (i.customerPct / 100);
  const network = tvl * (i.networkPct / 100);
  const ops = i.agents * i.opsPerAgentCr;
  const surplus = gross - customer - network - ops;
  return { tvl, gross, customer, network, ops, surplus, margin: gross > 0 ? surplus / gross : 0 };
}

/** 12.5 -> "₹12.50 Cr". */
export const crore = (v: number) => `₹${v.toFixed(2)} Cr`;
