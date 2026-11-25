# JanSetu backend (BNB Smart Chain TESTNET only)

Small server the app talks to. The app still works without it; this adds:

| Feature | What it does |
|---|---|
| Gas relay (`POST /relay`) | Pays the BNB network fee for users by forwarding their signed request through the ERC-2771 forwarder. Only JanSetu contracts, no value transfers, daily limits per wallet, simulated before sending. |
| Agent search (`GET /agents?pincode=`) | Agents list themselves with a signed message; only agents that are active on-chain and meet the minimum stake are returned. Exact location is never stored. |
| History and notifications | Reads contract events into a local database and turns them into plain-language items. Optional push through Expo. |
| Disputes (`POST /disputes`) | Stores the evidence note a party signs, returns an evidence hash to use in `openDispute`. Ops read tickets with the admin token. |
| Commissions (`GET /commissions/:agent`) | Lists deposits where an agent has commission ready to claim. |

## Run it (on your server)
1. Deploy the contracts first, so `contracts/deployments/bscTestnet.json` exists. Copy it here as `deployments/bscTestnet.json`.
2. `cp .env.example .env` then edit it:
   - `RELAYER_PRIVATE_KEY`: make a NEW wallet used only for this, send it ~0.5 test BNB. Never reuse a wallet that holds anything else.
   - `ADMIN_TOKEN`: any long random text (24+ characters).
3. `docker compose up -d --build`
4. Check: `curl http://localhost:8080/health`
5. Put it behind HTTPS (for example Caddy or Cloudflare Tunnel) and set `EXPO_PUBLIC_API_URL=https://your-domain` when building the app.

Without Docker: `npm install && npm start` (Node 22.13 or newer).

## Safety rules built in
- Refuses to start if the deployment file is not chain 97.
- Relay: allow-list of JanSetu contracts only (not timelock, treasury, emergency or yield contracts), value must be 0, gas capped, deadline max 1 hour, per-wallet and global daily limits, relayer balance check, simulation before sending.
- Signed requests (agent profile, device token, disputes) expire after 10 minutes and must match the wallet.
- Rate limits on every route, strict input validation, security headers, secrets never logged.
- The relayer key can only spend test BNB on gas. It holds no roles on any contract.

## Tests
`npm test`

## KYC desk (testnet)
Set `OPS_PRIVATE_KEY` and `TESTNET_KYC_DESK=1`. Endpoints: `POST /kyc`, `GET /kyc/:address`. Approve with `node contracts/scripts/ops.mjs kyc-all`.
