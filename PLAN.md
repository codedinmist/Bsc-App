# JANSETU WEB3: Build plan

## 1. What gets built
- **Chain:** BNB Smart Chain Testnet (chainId 97), Solidity ^0.8.24, Hardhat + Foundry, OpenZeppelin, Ethers v6.
- **App:** native Android APK. React Native + Expo (expo-router, TypeScript), Reanimated 3, Gesture Handler, Skia charts, wagmi/viem via Reown (WalletConnect).
- **Web:** small Next.js site for the Public Transparency Dashboard only.
- **Backend:** Node (Fastify), PostgreSQL, Prisma, Sign-In with Ethereum, event indexer, gas relayer, notification, dispute and QR services. Docker Compose for local and server.
- **Repo:** `contracts/`, `apps/mobile`, `apps/web`, `apps/api`, `apps/indexer`, `packages/abi`, `packages/ui`, `docs/`.

## 2. Contracts (all from the spec, plus the deck-only modules)
Spec's 17: INRToken (name "JanSetu Test Rupee", symbol tINR), JanSetuRegistry, CustomerVault, DailyVault, RecurringDepositVault, FixedDepositVault, AgentStaking, P2PEscrow, CommissionManager, MicroCredit, CollateralLoan, RewardsManager, CreditScoreNFT, DigitalReceiptNFT, Treasury, EmergencyController, ProtocolConfig.

Added to cover the deck:
| Contract | Deck source | Purpose |
|---|---|---|
| Faucet | spec 2 | Per-wallet limit and cooldown |
| JanSetuForwarder (ERC-2771, done) | approach | Relayer pays gas, so users see only tINR |
| AccountBonus (inside RewardsManager) | slide 8 | Account-opening bonuses and Super Recruiter Booster |
| AgentOnboarding (inside Registry) | slide 7 | Eligibility: 5,000 investment, 25,000 stake, 2 referrals |
| DreamRewardClub (inside RewardsManager) | slide 9 | Volume milestones (5L, 25L, 1Cr, 5Cr) |
| SundayJackpot | slide 10 | Weekly no-loss draw for on-time payers, funded from treasury |
| InsurancePool | slides 4, 10 | Accident cover (2L for 50,000+ savings), 30-day EMI relief |
| PredictionLP + MockPredictionMarket | slides 4, 6 | LP deposits, 2% fee split 50/50, weekly fee bonus |
| YieldStrategyAdapter + MockStrategy | slide 6 | Interface for DeFi yield. Testnet uses a mock marked Simulated |
| LoanLiquidityPool | slides 5, 6 | Funds Vyapar and collateral loans. Funded, never created |

## 3. Deck rules to encode exactly (config defaults)
- **Daily:** tiers 50/100/200/500, 12 months, early claim after 30 days.
- **RD plans:** 1,000×1yr (18%), 2,000×3yr (21%), 3,000×5yr (24%), 5,000×5yr (24%).
- **FD:** 1yr 20%, 2yr 21.5%, 3yr 23%. 2L accident cover at 50,000+.
- **Commissions (percent of deposit), exact:**

| Role | Daily 12 | RD 20 | FD 15 | Other |
|---|---|---|---|---|
| Agent | 8 | 13 | 9.5 | 1.5 P2P + 2.5 recovery |
| Cluster | 1.75 | 3 | 2.25 | 0.75 team loan volume |
| District | 1 | 2 | 1.5 | Prediction LP share |
| State | 0.75 | 1.25 | 1 | 1 state turnover |
| DAO | 0.5 | 0.75 | 0.75 | insurance and development |

- **Roles (slide 7):** Agent: 5,000 + 25,000 stake + 2 referrals. Cluster: 10 agents + 15L. District: 5 clusters + 1Cr. State: 10 districts + 10Cr. Cluster dispute SLA 24h. Promotion needs governance approval.
- **Bonuses (slide 8):** Daily 100+/day for 7 days = 100. RD 1,000+/month = 250. FD 25,000+ = 500, 1L+ = 1,500. 25 accounts/month = 5,000 booster. RD 3-5yr plan within 90 days = +20% commission.
- **Vyapar loan:** 15 daily deposits of 100, then agent verification, 10,000 loan, repay 100×120 = 12,000.
- **Collateral loan:** up to 80% of Daily/RD/FD, about 1 minute processing.
- **Credit score:** on-time repayments raise a soulbound NFT. High score unlocks 50,000 loans without agent verification.
- **Jackpot:** weekly, 100 winners, 500 to 10,000 each.
- **P2P timers:** 2-hour delivery window, 6-digit OTP, QR.
- **Projection tables (slides 3, 4):** store as **lookup data** for the Projected calculator. Do not derive them from a formula or present them as guaranteed. District P&L (slide 13) is a calculator page labelled Projected.

## 4. Approach decisions (made by me, not open questions)
1. **Funding model:** customer principal sits 1:1 in its vault and is never lent or invested. Rewards, commissions, bonuses, jackpot and insurance are paid from separate funded pools. The reserve is set aside when a deposit opens. If a pool is short, the reward shows as unfunded rather than being created from nothing. This follows the spec's solvency rules while keeping every deck rate.
2. **Cash-in direction:** agent locks tINR in escrow first and the customer sees "funded" before handing over cash. This matches the deck: "customer pays only after the digital receipt shows".
3. **OTP:** the customer's 6-digit code is a display aid. The real proof is an EIP-712 signature from the customer wallet (nonce, deadline, txId) carried in the QR. A bare 6-digit code is never accepted alone, because it can be brute-forced.
4. **Commission earning:** commissions vest over the deposit term and are cancelled on early withdrawal, so deposit-then-withdraw can't farm them.
5. **Collateral loans:** loan and collateral are both tINR, so there is no price oracle. Liquidation applies only after default and grace, up to the amount owed.
6. **Receipts:** every action emits a receipt event. NFTs mint for FD, loan completion, and on request.
7. **Multisig:** Safe 3-of-5 owns the TimelockController (48h). First check Safe deployment on BSC testnet. If missing, deploy Safe's official contracts from `safe-smart-account`. Operations multisig (narrow roles) handles verification and attestations.
8. **Wallets:** external (MetaMask, Trust, WalletConnect) and an in-app wallet (key in Android Keystore, biometric gated, relayer-paid gas).
9. **Agent discovery:** server-side by district/pincode. Exact location never on-chain.
10. **Mock services:** SMS, push and maps use clearly labelled providers or stubs behind interfaces.

## 5. Design system (Apple-grade, green and white)
- **Palette:** #087443, #0C9F6A, #DDF5E8, #F7FAF8, #FFFFFF, #17251E, #738078. Dark mode: deep green-black surfaces, same accents.
- **Type:** Inter (SF can't ship on Android). SF-style scale, tabular numerals for money. Large collapsing titles.
- **Layout:** 4/8pt grid, bottom tab bar (Home, Savings, Pay, Credit, More), bottom sheets with drag handle, 12–16px radii.
- **Motion rules:**
  - Springs critically damped (damping ratio ≥ 1). No overshoot or bounce.
  - 220–380ms, ease-out in, ease-in out.
  - Shared-element transition from card to detail.
  - Odometer-style number roll for balances.
  - Transaction ring fills through signed, broadcast, confirmed, then becomes a check only on a successful receipt.
  - Slow shimmer skeletons. Charts draw once and scrub on touch.
  - Reduce-motion falls back to fades.
- **Haptics:** light on select, firm on confirmed.
- **Security UX:** biometric before any money action. Plain-language copy, no crypto jargon.

## 6. The 24 screens
Home, Savings hub, J-Daily, RD, FD, Cash-In, Cash-Out, Find Agent, Merchant Loans, Collateral Loans, Portfolio, Rewards (incl. bonuses, club, jackpot), Credit Score, Digital Passbook, Agent, Cluster, District, State Governance, Treasury, DAO Governance, Public Transparency, Faucet, History, Profile.
Each screen maps to a contract or is marked Simulated.

## 7. Phases (finish and test each before the next)
**Status: Phase 1 and 2 contracts, tests, deploy/verify/ABI scripts are complete (frontend parts of those phases not started). Start at Phase 3.**
**Android app foundation (Expo) built early: design system, wallet, Home/Faucet/Daily/RD/FD/Transparency/Settings. P2P, loans, rewards, governance screens are placeholders until their contracts exist.**

1. **Foundation:** repo, Hardhat + Foundry, BSC testnet config, tINR, Faucet, Forwarder, ABI package, wallet connect, faucet screen.
2. **Core savings:** Daily, RD, FD, receipts, savings UI, tests.
3. **P2P network:** Registry, onboarding, AgentStaking, P2PEscrow, QR flow, disputes, agent discovery.
4. **Credit:** MicroCredit, CollateralLoan, LoanLiquidityPool, repayments, credit dashboard.
5. **Commissions and governance:** CommissionManager, RewardsManager (bonuses, club), CreditScoreNFT, Treasury, Safe, Timelock, Insurance, Jackpot, Prediction LP.
6. **Frontend and analytics:** all remaining screens, indexer, transparency dashboard, notifications.
7. **Security:** full test run, fuzz and invariants (spec §9), Slither, access-control review, economic-attack review, audit package.
8. **Testnet release:** deploy, verify on BscScan, publish addresses, build the signed APK, end-to-end test, docs.

## 8. Acceptance checks per phase
- All tests pass, including invariants listed in spec §9.
- Slither has zero critical or high findings.
- `tsc --noEmit` clean. No `@ts-ignore`.
- Every screen either reads real contract state or shows a Simulated chip.
- A transaction is shown as successful only after receipt status 1.
- Gas report and security findings report updated.

## 9. Deliverables
Everything in spec §11, plus: signed APK, `docs/` with contract dependency diagram, transaction flow diagram, role-permission matrix, accounting and liability model, function/event/access list, deployment guide, testnet user guide.

## 10. APK build
`expo prebuild` then `cd android && ./gradlew assembleRelease` with a keystore from `.env`. Needs JDK 17 and the Android SDK on the server. Output: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`.

## 11. First command for Claude Code
"Read CLAUDE.md and PLAN.md, then begin Phase 1. Stop and summarise when Phase 1 acceptance checks pass."


## 10. Status (updated)
- Phases 1-3 deployed on BNB Testnet and verified by check.ts.
- Phase 4 written and tested, **not yet deployed**: Treasury, EmergencyController, CommissionManager, RewardsManager, SundayJackpot, InsurancePool, PredictionLP + MockPredictionMarket, YieldStrategyAdapter + MockStrategy, LoanLiquidityPool, CreditScoreNFT, MicroCredit, CollateralLoan. All user-facing contracts accept gas-sponsored (ERC-2771) calls.
- App: Wallet-style home, Pay, Credit, Rewards, Agent tools, Help, tour. Backend: relay, agent search, indexer, notifications, disputes, commissions.
- Security: root/hook detection and certificate pinning built (pinning needs your pins). Independent audit still required before any real money.

- Governance: real **3-of-5 JanSetuMultiSig** (deck slide 12) now owns the 48h timelock. Easy-deploy creates 5 demo owner keys on testnet; real use needs 5 separate people or a Safe (docs/MULTISIG.md). Ops multisig for day-to-day roles still open.
