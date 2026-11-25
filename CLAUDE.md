# JANSETU WEB3: Claude Code project rules

Source of truth, in order:
1. `JANSETU_Web3_Master_Pitch_Deck.pptx` (16 slides). Product behaviour, rates, tiers, roles, incentives. Build it as the deck says.
2. `JANSETU_spec.md` (the full product and smart-contract specification). Security and architecture rules.
3. `PLAN.md` (this repo). Phases, approach decisions, acceptance checks.

If the deck and the spec disagree on product behaviour, the deck wins. If they disagree on security, the spec wins.

## Scope decisions (owner has confirmed)
- Build the **entire deck**, including the account-opening bonuses, Super Recruiter Booster, agent referral requirement, Dream Reward Club, Sunday Jackpot, Prediction Market LP, DAO safety cover and the on-chain credit score unlocking loans.
- Legal review (NBFC, FIU-IND, TDS, insurance, prediction markets, deposit and recruitment law) is handled by the owner **before mainnet**. Do not remove, water down or second-guess features for legal reasons. Do not add legal disclaimers beyond the testnet labels below.
- Every incentive and risky module is built as **parameter-driven** (rates, thresholds and an on/off flag in `ProtocolConfig`) so legal can retune it without redeploying.

## Testnet labelling (required, keep it short)
- Token is **JanSetu Test Rupee (tINR)**. Never show it as real rupees. No 1:1 peg claim.
- A persistent "BNB Testnet" badge in the app and on the web dashboard.
- Anything that is not on-chain real (DeFi yield, Prediction Market volume, SMS, push, maps) carries a **"Simulated"** chip.
- Deck projections (maturity, APY, P&L) are shown only as **"Projected"** and never as a balance.

## Non-negotiables (from the spec; do not weaken)
1. One contract per responsibility. No monolith. No unrestricted upgradeability. No delegatecall. No tx.origin for auth.
2. OpenZeppelin AccessControl with least privilege. Nobody can grant themselves a role. No admin withdrawal of customer funds.
3. ReentrancyGuard, checks-effects-interactions, SafeERC20, pull payments, deadlines, replay protection, explicit state machines.
4. Principal liabilities and reward/commission liabilities are tracked **separately**. Rewards and commissions are paid only from funded pools. Never pay old users from new deposits. Never create synthetic balances.
5. Treasury moves only via Safe 3-of-5 and a 48-hour TimelockController. No hidden emergency withdraw.
6. Slashing only after a resolved dispute, within a limit, with an appeal window. Never because a timer expired.
7. Pause blocks new risk (deposits, loans, escrows) but never blocks withdrawals, repayments or refunds.
8. Never put Aadhaar, PAN, phone or bank data on-chain or in NFT metadata. KYC is a flag or attestation only.
9. Never ask for a private key or seed phrase. Secrets live in server env only. No private keys in the app bundle.
10. Never show success until the transaction receipt says success.
11. No fake balances, hard-coded success responses or invented APIs. Use documented APIs only.
12. Do not disable TypeScript checks, suppress compiler errors or hide Slither findings. No deploy with open critical or high findings. Do not call the contracts "audited".

## Security (read docs/SECURITY.md before each phase; it is binding)
- Contracts: follow section 1. Relayer: section 2. Backend/server: section 3. Android app: section 4. Release: section 5.
- Never claim the system is "audited" or "fully secure". Report what was tested and what was not.
- The deployer key is never read, printed or committed by Claude Code. The owner runs deploy commands.

## Current status
- Phase 1 and 2 contracts are DONE and tested in `contracts/` (45 tests pass). See docs/SECURITY_FINDINGS.md for open items F5, F7, F9, F10.
- Android app (Expo SDK 58, `apps/mobile`) is started: design system, wallet, Home, Faucet, J-Daily, RD, FD, Transparency, Settings. 21 jest tests + `tsc` clean + Android bundle builds. Not yet run on a physical phone. Read docs/DESIGN.md and docs/EAS_BUILD.md.
- Expo changes between SDKs: before touching an Expo or React Native API, check the installed package types or the matching docs. Use `expo install`-resolved versions (offline: node_modules/expo/bundledNativeModules.json).
- Continue from Phase 3 (contracts), then add the matching app screens. Existing contracts: INRToken, JanSetuForwarder, JanSetuFaucet, ProtocolConfig, JanSetuRegistry,
  DigitalReceiptNFT, VaultBase, DailyVault, RecurringDepositVault, FixedDepositVault, JanSetuTimelock.

## Working rules
- Work phase by phase (see PLAN.md). Finish, test and commit each phase before starting the next. Show the owner a summary after each phase.
- Run `npx hardhat test`, `forge test`, `slither .` and `npx tsc --noEmit` before every commit.
- Secrets: `.env` is git-ignored. Provide `.env.example` only.
- Commit style: small, one concern each.
