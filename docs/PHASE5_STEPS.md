# Phase 5: what to run (copy and paste, one line at a time)

Phase 5 adds everything that was still missing from the deck: agent eligibility rules, ranks (cluster / district / state), service commissions, the RD +20% boost, the KYC gate, the Apple-Pay-style confirm sheet, the district model, notifications and the card-stack reorder. **Nothing is live until you deploy it.**

## 1. Unpack (VPS)
```
cd ~ && unzip -o jansetu-phase5.zip -d jansetu-new && cp jansetu/contracts/.env jansetu-new/jansetu/contracts/.env && cp jansetu/contracts/wallets.txt jansetu-new/jansetu/contracts/ 2>/dev/null; cd jansetu-new/jansetu/contracts && npm install
```

## 2. Test
```
OFFLINE_SOLC=0 npx hardhat test
```
Expect `123 passing`.

## 3. Deploy (only the publicnode RPC works from your VPS)
```
BSC_TESTNET_RPC=https://bsc-testnet-rpc.publicnode.com npm run easy-deploy
```
Then check it:
```
BSC_TESTNET_RPC=https://bsc-testnet-rpc.publicnode.com npx hardhat run scripts/check.ts --network bscTestnet
```
Look for `ALL CHECKS PASSED`.

## 4. Ops commands (KYC, agents, ranks)
Approve every KYC request waiting in the app:
```
BSC_TESTNET_RPC=https://bsc-testnet-rpc.publicnode.com node scripts/ops.mjs kyc-all
```
Approve one wallet: `node scripts/ops.mjs kyc 0xWALLET`. Check why a wallet is not yet an agent: `node scripts/ops.mjs agent-status 0xWALLET`. Make a wallet an agent: `node scripts/ops.mjs make-agent 0xWALLET`. Show ranks: `node scripts/ops.mjs ranks`.

Keeper (pays service commissions, syncs rank volume), run it in a second Termius tab:
```
BSC_TESTNET_RPC=https://bsc-testnet-rpc.publicnode.com node scripts/ops.mjs keeper --loop
```
For a quick demo with small thresholds, deploy with `RANKS_PROFILE=demo` in front of the deploy command.

## 5. Backend (KYC desk, free fees)
In `backend/.env` set `OPS_PRIVATE_KEY` (the ADMIN wallet key) and `TESTNET_KYC_DESK=1`. This lets the app's "Verify" button queue KYC requests. Then `npm start`.

## 6. Link the app and build the APK
```
cd ~/jansetu-new/jansetu/apps/mobile && npm install && npm run sync:contracts && npx eas-cli build --platform android --profile preview
```

## Honest limits
- Push alerts need Firebase and are not built; the in-app notification feed works.
- The KYC desk is testnet-only; real KYC needs a provider.
- Prediction market and yield strategy are test mocks; Dream Club prizes are placeholders.
- Motion and Android rendering were checked on a desktop preview, not a real phone.
- Real multisig owners, audit and legal review are yours to arrange.

## Quick agent on the server (no second phone needed)
```
cd ~/jansetu-new/jansetu/contracts && BSC_TESTNET_RPC=https://bsc-testnet-rpc.publicnode.com node scripts/ops.mjs demo-agent
```
Creates one agent and two customers, gives the agent test tINR from the deployer wallet, stakes, opens the 5,000 deposit, makes both customers choose the agent, verifies the agent, and prints the agent's 12 words. In the app: Welcome -> "I already have a recovery phrase".
Note: the faucet only gives 1,000 tINR a day (10,000 max), so to give any wallet more tINR use `node scripts/ops.mjs give 0xWALLET 30000`.
