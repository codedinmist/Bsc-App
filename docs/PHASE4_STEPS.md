# Phase 4: what to run (copy and paste, one block at a time)

Everything new is in this project. **Nothing new is live until you deploy it.** The earlier contracts stay on the chain, but the app will point to the new set after step 3.

## 1. On your VPS: upload the new zip and unpack it next to the old folder
```
cd ~
unzip -o jansetu-phase4.zip -d jansetu-new
cp jansetu/contracts/.env jansetu-new/jansetu/contracts/.env      # keeps your testnet wallets
cp jansetu/contracts/wallets.txt jansetu-new/jansetu/contracts/ 2>/dev/null || true
cd jansetu-new/jansetu/contracts && npm install
```

## 2. Check the contracts (about 1 minute)
```
OFFLINE_SOLC=0 npx hardhat test
```
You should see `106 passing` (more than that is fine).

## 3. Deploy everything again (this now includes the 3-of-5 multisig)
```
npm run easy-deploy
```
It creates the five multisig owner wallets (saved in `.env` and `wallets.txt`) and needs about 0.05 test BNB in the deployer wallet. If it asks for more, get it free from the BNB testnet faucet and it continues by itself. At the end run:
```
npx hardhat run scripts/check.ts --network bscTestnet
```
and look for `ALL CHECKS PASSED`. It now also checks that the multisig is 3-of-5 and owns the 48 hour timelock. See `docs/MULTISIG.md` for the approval demo.

## 4. Link the app
```
cd ../apps/mobile && npm install && npm run sync:contracts
```

## 5. Backend (free fees, agent search, notifications) - optional but recommended
```
cd ../../backend && cp .env.example .env && nano .env
```
Fill `RELAYER_PRIVATE_KEY` with a NEW wallet (send it 0.3 test BNB) and `ADMIN_TOKEN` with any 30+ random characters. Then:
```
mkdir -p deployments && cp ../contracts/deployments/bscTestnet.json deployments/
docker compose up -d --build
curl http://localhost:8080/health
```
Put it behind HTTPS (Caddy or Cloudflare Tunnel), then build the app with `EXPO_PUBLIC_API_URL=https://your-domain`.

## 6. Build the APK
Same as before: `npx eas-cli build --platform android --profile preview`.
If your phone is rooted the app will refuse to sign (by design). Add `EXPO_PUBLIC_ALLOW_ROOTED=1` to the build only for your own testing.

## 7. Optional: turn on certificate pinning
```
bash scripts/get-pins.sh your-domain.com
```
Copy the two pins into `EXPO_PUBLIC_PINS` as printed, then rebuild.

## First-time set up after deploying (the operations wallet does this)
- Make someone an agent: `registry.assignAgent(address, cluster, district, state)` then `registry.setAgentVerified(address, true)`.
- Set area heads for commissions: `commissions.setHead(level, areaId, address)` (1 cluster, 2 district, 3 state). A missing head sends that share to the DAO treasury.
- Fund pools you want to demo (Rewards, Draw, Insurance, Commissions, Loan pool). The deploy already puts test tINR in each.
