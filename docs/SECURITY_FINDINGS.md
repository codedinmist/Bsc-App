# Security findings: Phase 1-2 contracts

Status: **self-reviewed with automated tools only. Not independently audited. Do not use with real funds.**

## Evidence
- 45 automated tests pass (unit, forwarder replay/forgery, governance hand-over, accounting invariants over random sequences).
- Slither (102 detectors): 0 high, 1 "medium" (benign, see F1), 11 timestamp comparisons (expected, see F2), 1 event-order note (fixed), 4 dead-code notes. Raw output: `contracts/reports/slither.json`.
- Gas report: `contracts/reports/gas-report.txt` (Hardhat, 200 optimiser runs).
- Not yet run: Foundry invariant campaign, Echidna, formal analysis. These run on your server (PLAN.md section 8).

## Findings
| ID | Severity | Item | Status |
|---|---|---|---|
| F1 | Info | Slither "incorrect-equality" in `JanSetuFaucet.nextClaimAt` (`last == 0` means "never claimed") | Accepted: read-only sentinel check |
| F2 | Info | Time-based logic uses `block.timestamp` (deposits, maturity, grace) | Accepted: day/month granularity, validator skew (seconds) is irrelevant |
| F3 | Fixed | Receipts used `_safeMint`, so a contract wallet could revert and block an agent's deposit for it | Fixed: plain `_mint`, receipts are non-transferable anyway |
| F4 | Fixed | Governance hand-over renounced the deployer's admin role before finishing grants | Fixed and covered by a test |
| F5 | Design note | Pausing the token (`INRToken.pause`) freezes ALL transfers, including vault withdrawals. Vault-level pause does not. | Open: PLAN says withdrawals must stay available; Phase 5 `EmergencyController` should pause vaults, and the token pause should stay a last resort held by the guardian multisig |
| F6 | Design note | Rewards put into a pool cannot be taken back by anyone (no admin withdrawal) | Intended; fund the pool carefully |
| F7 | Design note | `addPlan`/`addTerm` allow reward targets up to 200%. Payouts are capped by the funded pool, but the UI could show an unrealistic target | Open: Phase 5 should read an upper bound from `ProtocolConfig` |
| F8 | Design note | Faucet can be drained by many fresh wallets (sybil). Testnet only | Accepted; relayer and API add rate limits |
| F9 | Open | Collateral flow (`pledge/release/seize`) is tested with a stand-in address. The real `CollateralLoan` contract does not exist yet | Re-review in Phase 4 |
| F10 | Open | Safe availability on BNB testnet unverified from my environment | Check in server step 6.3 |
| F11 | Open | Deployer holds the initial 100M tINR before it is distributed (testnet) | Accepted for testnet |

## What was deliberately not claimed
No yield, APY or maturity value is promised by any contract. Deck projections exist only as `rewardBps` targets that are paid
only from funded pools; otherwise the position records an "unfunded" reward and pays principal only.
