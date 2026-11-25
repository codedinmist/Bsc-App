# JANSETU security requirements (binding on every phase)

"Super secure" means layered defence: if one layer fails, the next one still protects the user. Nothing here makes the system
"unhackable" or "audited". Only an independent audit and a bug bounty can support such a claim.

## 1. Smart contracts
Already implemented and tested (Phase 1-2): AccessControl with least privilege; no admin withdrawal; ReentrancyGuard and
checks-effects-interactions; SafeERC20 plus balance-delta check (rejects fee-on-transfer tokens); bounded config values;
48h timelock with the deployer holding zero roles afterwards; guardian can pause but cannot move money; pause never blocks
withdrawals; non-transferable receipts using plain `_mint` (no recipient callback); terms snapshotted per position;
rewards payable only from funded pools; per-vault solvency check `isSolvent()`; owner-initiated collateral pledges only.

Required for later phases:
- Escrow release only with the customer's EIP-712 signature (nonce, deadline, txId, chainId). A 6-digit code alone is never proof.
- Slashing only after a resolved dispute, bounded, with an appeal window. No timer-based slashing.
- Every new contract gets: unit tests, a randomised invariant test, Slither with zero high/medium, a function/role table in docs.
- Foundry invariant tests in addition to the Hardhat ones (see PLAN.md section 8).
- No upgradeable proxies. No delegatecall. No tx.origin. Only the trusted forwarder may supply a sender suffix.
- Before any mainnet use: independent audit by a professional firm, a public bug bounty, and legal sign-off (owner's responsibility).

## 2. Gas relayer (the most attacked part of any gasless app)
- Relay only calls to allow-listed contracts and function selectors. Never relay arbitrary calls.
- Simulate (eth_call) before sending; refuse reverting calls so the relayer never burns gas on junk.
- Per-wallet and per-IP rate limits; daily and per-tx gas budgets; a circuit breaker that stops relaying when the budget is spent.
- The relayer key is a separate, low-balance hot wallet with no contract roles. Alert when its balance is low or drained.
- Verify the EIP-712 signature and deadline server-side before spending any gas.

## 3. Backend and server
- Sign-In With Ethereum: single-use nonce, domain binding, short-lived access token (15 min), rotating refresh token tied to the device, server-side revocation.
- Validate every input with a schema (zod). Parameterised queries only (Prisma). Strict CORS. Security headers (helmet). Rate limits on every route, tighter on auth, relayer and faucet.
- Idempotency keys on every state-changing endpoint. The blockchain is the source of truth; the database can never mark something "paid".
- Postgres: internal network only, TLS, separate least-privilege roles (the API cannot DROP), encrypted backups, no personal data beyond what the feature needs.
- Never store Aadhaar, PAN, bank or raw KYC documents. Keep only a KYC status flag and a reference to the licensed KYC provider.
- Secrets: environment files with mode 600, never in git, never in the app. Rotate on any suspicion. Separate keys for deployer, relayer, ops.
- Logging: structured, no tokens or personal data, append-only audit log for admin and dispute actions.
- Monitoring: alert on role changes, pauses, large movements, relayer drain, indexer lag, repeated failed logins. Do not depend on a vendor that may be shut down; run alerts from our own indexer.
- Server: SSH keys only, firewall, fail2ban, automatic security updates, non-root services, containers with dropped capabilities and read-only filesystems where possible.
- Dependencies: committed lockfiles, `npm audit` in CI, pinned versions, no install scripts from unknown packages, generate an SBOM.

## 4. Android app
Keys and signing
- The in-app wallet key is generated on the device. Android Keystore cannot hold secp256k1 keys, so the key is encrypted with a hardware-backed AES key that requires biometric or device PIN, and is decrypted in memory only to sign, then wiped. State this limit honestly in the app's security page.
- Every signature requires biometric or PIN. Re-authenticate after 60 seconds in the background. Auto-lock the app.
- Backup phrase: shown once, on a screen that blocks screenshots, only when the user chooses it. The app never asks for a seed phrase or private key from an external wallet.
- Show a human-readable preview of every transaction (decoded locally from the typed data): who, what, how much, which contract.
  Refuse to sign for any contract address that is not in the embedded, hash-pinned address list.

Device and app hardening
- `FLAG_SECURE` on all financial screens (no screenshots, hidden in the recent-apps view). Tap-jacking protection (`filterTouchesWhenObscured`).
- `allowBackup=false` and no cloud/device-transfer extraction of app data. Release builds not debuggable, no logging, R8 obfuscation, Hermes bytecode.
- Network security config: no cleartext traffic; TLS 1.2+; certificate (public-key) pinning with a backup pin for the API.
- Root, emulator, debugger and hooking (Frida) detection: degrade to read-only mode and warn. Use Play Integrity attestation for Play-distributed builds (not available to sideloaded APKs).
- Verified deep links only; strictly parse and validate every incoming link and QR payload (length, chain id, expiry, signature) before showing it.
- Clipboard: never copy secrets; clear copied addresses after 30 seconds. No third-party analytics or ad SDKs.
- Store only session tokens in the Keystore-backed secure store. Local cache is encrypted.

Anti-phishing
- Show the contract name and a short address with a verified badge from the pinned list. Warn on first-time recipients. Daily send limits configurable by the user.

## 5. Build and release
- The release keystore is generated on the server, backed up offline, and never committed. Pass passwords through environment variables, not files in the repo.
- Reproducible build steps documented. Verify the APK signature with `apksigner verify` and publish its SHA-256 hash alongside the testnet contract addresses.
- Dependency review before each release; `npm audit` clean or exceptions documented.

## 6. Testing the security
- Contract: unit, randomised, Foundry invariants, Slither, manual access-control review, economic-attack review (griefing, dust, reentrancy through tokens, front-running, replay).
- App: static analysis (MobSF), dynamic test on a rooted device, intercept-proxy test to confirm pinning, review of the decoded transaction previews.
- Backend: OWASP ASVS checklist, dependency scan, rate-limit and auth abuse tests.

## 7. Implementation status (Android app, as built so far)
| Control | Status |
|---|---|
| Wallet key behind biometric/PIN for every signature (expo-secure-store, hardware-backed) | Done |
| App refuses to run without a device screen lock when creating a key | Done |
| Sign only to pinned contract addresses | Done, unit-tested |
| Simulate before send; "success" only after the on-chain receipt | Done |
| Exact-amount token approvals (no unlimited allowance) | Done |
| Screenshots and screen recording blocked app-wide | Done |
| `allowBackup=false`, no cleartext HTTP, R8 minify and resource shrink in release | Done (build config) |
| Clipboard cleared 30 s after copying an address | Done |
| Recovery phrase never stored; backup check at creation | Done |
| App contract interfaces verified against compiled contracts | Done, unit-tested |
| Certificate pinning | Built and unit-tested (react-native-ssl-public-key-pinning). It switches on only when you set `EXPO_PUBLIC_PINS` for your API host with two pins (`apps/mobile/scripts/get-pins.sh`). Until then Settings shows "Off". |
| Root and Frida/Xposed detection | Done, unit-tested. A rooted or hooked phone cannot create a wallet or sign (fails closed). Debug builds and the `EXPO_PUBLIC_ALLOW_ROOTED=1` build flag are the only overrides. Detection is best effort and can be bypassed by a skilled attacker. Play Integrity is not available to sideloaded APKs (not done). |
| Gas relayer (gasless use) | Built and unit-tested (`backend/`): allow-list of JanSetu contracts, zero value, gas cap, 1-hour deadline, per-wallet and global daily limits, simulation before sending, relayer balance check. Every user-facing contract trusts the forwarder (tested on-chain). Needs you to run the backend and fund the relayer wallet. |
| Decoded transaction preview screen before biometric prompt | Partly: the sheet shows the action title and step; a full decoded preview is still to build |
| Independent security test of the APK (MobSF, rooted device) | Not yet |


## Multisig status
3-of-5 `JanSetuMultiSig` owns the 48h timelock (tests: 9 passing; not independently audited). Testnet demo keys live in `.env`; real use needs five separate owners or a Safe. See docs/MULTISIG.md.

## Phase 5 notes
- Service commissions, rank bonuses and the RD boost are paid from funded pools, never customer principal (`ServiceCommission.isSolvent`).
- NetworkRanks holds RANKS_ROLE, which can only call `CommissionManager.setHead`.
- The testnet KYC desk (`TESTNET_KYC_DESK=1`) uses an ops key and must be disabled outside testnet.
