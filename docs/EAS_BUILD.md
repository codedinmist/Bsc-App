# Build the Android APK with Expo EAS (phone + VPS, no Android SDK needed)

EAS builds the app on Expo's servers. Your VPS only runs Node and uploads the project. Everything below is typed in Termius as the `jansetu` user.

## One-time
1. On your phone browser, create a free account at https://expo.dev and verify your email.
2. In expo.dev: Account settings, Access tokens, create a token named "vps". Copy it (shown once).
3. On the server:
```bash
cd ~/jansetu/apps/mobile
npm ci
export EXPO_TOKEN='PASTE_TOKEN'        # lasts for this terminal session only; do not write it into any file in the repo
npx eas-cli whoami                     # should print your username
npx eas-cli init                       # answer Yes: links the project and writes its id into app.json
```

## Every build
```bash
cd ~/jansetu/apps/mobile
npm run sync:contracts                 # copies deployed addresses (needs contracts/deployments/bscTestnet.json)
npm run typecheck && npm test
npm run build:apk                      # = eas build --platform android --profile preview
```
- The first build asks whether to generate an Android keystore. Say Yes (Expo stores it for you).
  Afterwards run `npx eas-cli credentials` and download a backup copy. If you lose the key you cannot update the installed app.
- When the build finishes (about 10 to 20 minutes, free plan may queue) it prints a link. Open the link on your phone, download the APK, and tap to install ("allow from this source").

## Things to know
- EAS uploads your project files (not `node_modules`, not anything git-ignored). Never put a private key or `.env` inside `apps/mobile`.
- The server needs the project in a git repo (`git init && git add -A && git commit`) so EAS knows what to upload.
- Anything starting with `EXPO_PUBLIC_` is visible inside the app. Only put public values there (like an RPC URL).
- Android may warn "unknown app". That is normal for an APK you install yourself.
- Before the first real test: install the APK, create a wallet, write down the phrase, then use the BNB testnet faucet for a little test BNB.
