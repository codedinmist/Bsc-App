# 3-of-5 multisig (deck slides 7, 12 and 15)

**Rule from the deck:** any treasury transfer or governance change needs at least 3 of 5 owner approvals, and then still waits a public 48 hour time-lock.

## The five seats
1. Founder
2. State Governor representative
3. External security auditor
4. Top agent representative
5. Cold backup key (kept offline)

## How a change flows
1. One owner **proposes** (this counts as their approval).
2. Two more owners **approve**. Fewer than 3 and nothing can run.
3. Any owner **executes**. This only *schedules* the change in the public timelock.
4. After **48 hours**, three owners approve the final step, and the change happens.
5. Anyone can watch the timelock. A change that looks wrong can be cancelled by the multisig inside the 48 hours.

Nobody, including the deployer, can skip the 48 hour wait: the timelock has no admin.

## What it controls
- Everything that was handed to the timelock at deploy: token, config, registry, vaults, staking, escrow, treasury, commissions, rewards, loan pools, score, jackpot, insurance, prediction and yield contracts.
- The treasury: spending also has a daily cap.
- Slashed agent stakes go to the multisig.
- The owner list itself can only change by a 3-of-5 approved proposal (`replaceOwner`, `addOwner`, `removeOwner`, `changeThreshold`). A removed owner's old approvals stop counting.

## What it does NOT control (by design)
- **Emergency stop:** the guardian can pause quickly. Only the timelock can unpause.
- **Day-to-day operations:** approving agents, KYC flags, insurance claim decisions, dispute resolution. On testnet one ops wallet does this. Before real use, make this a second, smaller multisig.

## Testnet demo (the 5 owner keys are in `.env` as MULTISIG_KEY_1..5)
```
cd ~/jansetu-new/jansetu/contracts
node scripts/multisig.mjs status
node scripts/multisig.mjs propose-spend 0xRECIPIENT 1000 1
node scripts/multisig.mjs confirm 0 2
node scripts/multisig.mjs confirm 0 3
node scripts/multisig.mjs execute 0 1
```
The payment is now scheduled. After 48 hours:
```
node scripts/multisig.mjs propose-release 0xRECIPIENT 1000 1
node scripts/multisig.mjs confirm 1 2
node scripts/multisig.mjs confirm 1 3
node scripts/multisig.mjs execute 1 1
```
For the client demo, show `status` and the first four commands. Say clearly that the final step waits 48 hours by design.

## Before real money
- Each owner generates their **own** key on their **own** device (a hardware wallet is best). Never create all five on one server.
- Replace the testnet keys: put the five real owner addresses in `MULTISIG_OWNERS` (comma separated) and delete every `MULTISIG_KEY_n` line from `.env`.
- Prefer a **Safe** (Gnosis Safe) multisig: it is widely audited. BNB Chain runs a Safe service for BSC testnet at https://multisig.bnbchain.org . Create a 3-of-5 Safe there, then put its address in `SAFE_ADDRESS` and leave `MULTISIG_OWNERS` empty. The deploy then uses your Safe instead of `JanSetuMultiSig`.
- `JanSetuMultiSig` is a small, tested implementation but has **not** been independently audited.
- Add a second multisig for day-to-day operations.

## Phase 5 additions
NetworkRanks (admin + GOVERNOR on CommissionManager only via RANKS_ROLE, which can only call `setHead`) and ServiceCommission are included in the handover plan. Rank thresholds and service rates are changed through the multisig and timelock.
