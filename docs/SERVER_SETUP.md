# JanSetu: phone-only quick path (no laptop)

You only need a phone and one VPS. Steps 1 to 4 below replace sections 1 to 4 of this guide.

**A. Pick the VPS.** Ubuntu 24.04, at least 4 GB RAM (8 GB is better), 50 GB disk, 2+ vCPU. A 2 GB server cannot build the APK.

**B. Phone apps.** Install **Termius** (SSH + file transfer) and **MetaMask** or **Trust Wallet**. Use your phone's browser for the BNB faucet, BscScan and Safe.

**C. Make an SSH key in Termius** (Keychain, then generate an ed25519 key). Copy its public key. Paste it into your VPS provider's panel ("SSH keys") before or after creating the server, or log in as root with the provider's password and run:
`mkdir -p ~/.ssh && echo "PASTE_PUBLIC_KEY" >> ~/.ssh/authorized_keys`

**D. Upload and run the setup script.** If this VPS already runs other apps or has your files, use `bootstrap-safe.sh` (below) instead of `bootstrap-server.sh`. Take a VPS snapshot first.

**D (safe, existing server):**
```
apt-get install -y unzip && unzip /root/jansetu-phase1-2.zip -d /root/jansetu-src && bash /root/jansetu-src/scripts/bootstrap-safe.sh --swap
```
It only adds a new `jansetu` user and installs tools inside its home folder. Skip `--swap` if you already have swap.

**D (brand-new empty server only).** Download `jansetu-phase1-2.zip` from the chat to your phone. In Termius, connect as root, open the SFTP tab, and upload the zip to `/root`. Then run:
```
apt-get install -y unzip && unzip /root/jansetu-phase1-2.zip -d /root/jansetu && bash /root/jansetu/scripts/bootstrap-server.sh
```
It takes 10 to 20 minutes. When done, add a new Termius host with user `jansetu` and the same key (root login is now disabled).

**E. Always work inside tmux**, so a dropped phone connection never kills a running job:
```
tmux new -s jansetu        # start; later reattach with: tmux attach -t jansetu
claude                     # first run prints a login link: open it in your phone browser, sign in, paste the code back
```
Detach with Ctrl+B then D (Termius has a Ctrl button on its extra keys row).

**F. Wallets on a phone.** Create 8 accounts in MetaMask or Trust Wallet (Deployer, Ops, Guardian, 5 Safe signers). For a real 3-of-5 each signer should be a different person or device. Holding all five yourself is fine for a private testnet demo but is not real multisig security.

**G. Get the APK onto your phone.** After the build, open Termius SFTP on `jansetu@server`, go to `~/jansetu/apps/mobile/android/app/build/outputs/apk/release/`, and download `app-release.apk` to your phone. Tap it to install (allow "install unknown apps" for Termius once). Compare the SHA-256 shown by `sha256sum app-release.apk` on the server with the file on your phone.
Never serve the APK over plain HTTP.

**H. Deploying the contracts without a laptop.** Follow section 6 below, but type commands in Termius. Put the Deployer key into `contracts/.env` with `nano` (paste from the wallet's export, then clear your clipboard). Use a testnet-only wallet.

---

# JanSetu: server setup, step by step

Target: a fresh Ubuntu 24.04 (or 22.04) server. Minimum 4 vCPU, 8 GB RAM, 60 GB disk (the Android build needs the memory).
Commands starting with `$` are run on the server. Do each step in order.

## 1. Lock the server down first
```bash
$ adduser jansetu && usermod -aG sudo jansetu          # a normal user; do NOT work as root
$ mkdir -p /home/jansetu/.ssh && cp ~/.ssh/authorized_keys /home/jansetu/.ssh/ && chown -R jansetu:jansetu /home/jansetu/.ssh
# edit /etc/ssh/sshd_config: PermitRootLogin no, PasswordAuthentication no, then:
$ systemctl restart ssh
$ apt update && apt -y upgrade && apt -y install ufw fail2ban unattended-upgrades git build-essential curl unzip
$ ufw default deny incoming && ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable
$ dpkg-reconfigure -plow unattended-upgrades
```
Log out and log back in as `jansetu` (open a second terminal first to make sure key login works).

## 2. Install tools (as `jansetu`)
```bash
# Node 22
$ curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt -y install nodejs
# Docker
$ curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker jansetu   # log out/in after
# Java 17 for Android
$ sudo apt -y install openjdk-17-jdk
# Android SDK command-line tools
$ mkdir -p ~/android-sdk/cmdline-tools && cd ~/android-sdk/cmdline-tools
$ # download "Command line tools for Linux" from https://developer.android.com/studio#command-line-tools-only, unzip, rename the folder to "latest"
$ echo 'export ANDROID_HOME=$HOME/android-sdk; export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools' >> ~/.bashrc && source ~/.bashrc
$ yes | sdkmanager --licenses && sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
# Foundry (fuzz + invariant tests) and Slither
$ curl -L https://foundry.paradigm.xyz | bash && source ~/.bashrc && foundryup
$ sudo apt -y install pipx && pipx install slither-analyzer && pipx install solc-select && solc-select install 0.8.28 && solc-select use 0.8.28
```

## 3. Install Claude Code
```bash
$ npm install -g @anthropic-ai/claude-code
$ claude          # follow the login prompt once
```
Safety habits for Claude Code on this server:
- Run it as the `jansetu` user, never root. Keep the default permission mode so it asks before risky commands.
- Do **not** let it read your deployer key. You run the deploy command yourself (step 6).

## 4. Put the project on the server
```bash
$ mkdir -p ~/jansetu && cd ~/jansetu
# upload the zip you got from me, then:
$ unzip ~/jansetu-phase1-2.zip -d ~/jansetu && cd ~/jansetu
$ mkdir -p docs/source   # copy your pitch deck and spec file in here
$ git init && git add . && git commit -m "Phase 1-2 contracts"
```

## 5. Check everything works before touching the chain
```bash
$ cd contracts && npm ci
$ npx hardhat test                 # expect: 45 passing
$ npm run slither                  # expect: no high/medium findings (see docs/SECURITY_FINDINGS.md)
```

## 6. Prepare wallets, then deploy (you do this, not Claude)
1. Create these **testnet-only** wallets in MetaMask or Trust Wallet: Deployer, Ops, Guardian, and five Safe signers
   (Founder, State Governor rep, External auditor, Top Agent rep, Cold backup). Use separate hardware or cold storage for the cold key.
2. Get free test BNB for the Deployer from the official BNB Chain testnet faucet (https://www.bnbchain.org/en/testnet-faucet).
3. Create the **3-of-5 Safe** with those five signers at https://app.safe.global on BNB Smart Chain Testnet.
   If Safe does not list BNB Testnet, tell Claude Code: "Deploy Safe's official contracts to BSC testnet and create the 3-of-5 safe." Do not write your own multisig.
4. Create a BscScan API key at https://bscscan.com/myapikey.
5. Fill the config:
```bash
$ cd ~/jansetu/contracts && cp .env.example .env && chmod 600 .env && nano .env
```
6. Deploy and verify:
```bash
$ npm run deploy:testnet           # writes deployments/bscTestnet.json
$ npm run verify:testnet           # verifies source on BscScan
$ npm run abi                      # refreshes packages/abi
```
7. Open each address on https://testnet.bscscan.com and confirm: the deployer holds **no** admin role, the timelock owns config, and the faucet holds tINR.
8. After deployment, move the deployer key out of the server (or delete `.env`). It is not needed again unless you redeploy.

## 7. Continue the build with Claude Code
```bash
$ cd ~/jansetu && claude
```
First prompt:
> Read CLAUDE.md, PLAN.md and docs/SECURITY.md. Phases 1 and 2 (contracts) are done and tested. Continue with Phase 3 (Registry vouching, AgentStaking, P2PEscrow). Finish with tests, Slither and a summary before moving on.

Then, in order, one phase per session: Phase 3, 4, 5 (contracts); then the backend and indexer; then the Android app (Phase 6); then Phase 7 (security) and 8 (release).

## 8. Database and backend (when Claude Code reaches that phase)
```bash
$ cd ~/jansetu && docker compose up -d db      # Postgres on the internal Docker network only (never publish port 5432)
```
Put the API behind Caddy or Nginx with HTTPS (Let's Encrypt). Only ports 22, 80 and 443 are open.

## 9. Build the signed APK (when the app exists)
```bash
$ keytool -genkeypair -v -storetype PKCS12 -keystore ~/jansetu-release.keystore -alias jansetu -keyalg RSA -keysize 4096 -validity 10000
$ chmod 600 ~/jansetu-release.keystore             # back this file up offline; losing it means you can never update the app
$ cd ~/jansetu/apps/mobile && npm ci
$ npx expo prebuild --platform android --clean
# set the keystore path/passwords as environment variables (see docs/SECURITY.md section 5), then:
$ cd android && ./gradlew assembleRelease
$ $ANDROID_HOME/build-tools/35.0.0/apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
```
Download the APK with `scp jansetu@YOUR_SERVER:~/jansetu/apps/mobile/android/app/build/outputs/apk/release/app-release.apk .`
and install it on a phone (enable "install unknown apps" for your file manager).

## 10. Keep it healthy
- Back up Postgres nightly (encrypted) and the keystore (offline).
- `sudo unattended-upgrades` keeps the OS patched; run `npm audit` and `docker pull` monthly.
- Never put real money, real customer data or real Aadhaar/PAN into this testnet build.
