import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { useRouter } from "expo-router";
import { space } from "@/design/tokens";
import { addressUrl, chain } from "@/chain/config";
import { contracts } from "@/chain/deployments";
import { shortAddr } from "@/chain/format";
import { useWallet } from "@/wallet/WalletProvider";
import { copyTemporarily } from "@/lib/clipboard";
import { LargeTitleScreen } from "@/ui/LargeTitleScreen";
import { Banner, List, Row, Section, Segmented } from "@/ui/parts";
import { loadTheme, saveTheme, type ThemeMode } from "@/lib/theme";
import { isGuarded } from "@/wallet/keystore";
import { Sheet } from "@/ui/Sheet";
import { Button } from "@/ui/Button";
import { T } from "@/ui/Text";
import { Chip } from "@/ui/Chip";

import { checkDevice } from "@/security/device";
import { pinStatus } from "@/security/pinning";

export default function Settings() {
  const { address, remove } = useWallet();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>("system");
  const [guarded, setGuarded] = useState(true);
  useEffect(() => { loadTheme().then(setTheme); isGuarded().then(setGuarded); }, []);
  const dev = checkDevice();
  const pins = pinStatus();

  return (
    <LargeTitleScreen title="Settings" back>
      <Section title="Appearance" index={0}>
        <Segmented options={[{ label: "System", value: "system" }, { label: "Light", value: "light" }, { label: "Dark", value: "dark" }]} value={theme} onChange={(v) => { setTheme(v); saveTheme(v); }} />
      </Section>

      <Section title="Wallet" index={0}>
        <List>
          <Row icon="copy" title="Wallet address" subtitle={address ? shortAddr(address) : "—"} right={copied ? <Chip kind="success" label="Copied for 30 s" /> : undefined}
            onPress={async () => { if (address) { await copyTemporarily(address); setCopied(true); setTimeout(() => setCopied(false), 2500); } }} />
          <Row icon="external" title="View on BscScan" onPress={() => address && Linking.openURL(addressUrl(address))} />
          <Row icon="shield" title="Network" subtitle={`${chain.name} (chain ${chain.id})`} right={<Chip kind="testnet" label="Preview" />} last />
        </List>
      </Section>

      <Section title="How your key is protected" index={1}>
        <Banner title="Locked with your fingerprint, face or PIN" body="Your wallet key is encrypted with a hardware-backed key and unlocked only for a moment to sign each transaction. Android cannot keep this kind of key inside secure hardware itself, so a rooted or infected phone is a real risk. Screenshots and screen recording are blocked in this app." />
        {!guarded ? <Banner kind="warning" title="No screen lock on this phone" body="Your key is kept in the phone's encrypted storage, but it is not asked for each time. Set a fingerprint, face or PIN lock, then remove and restore the wallet to lock it." /> : null}
        <Banner kind="warning" title="Your recovery phrase is not stored" body="JanSetu cannot recover your wallet. If you change your phone's biometrics, restore with your phrase." />
      </Section>

      <Section title="Phone and network security" index={1}>
        <List>
          <Row icon="shield" title="Phone check" subtitle={dev.safe && !dev.overridden ? "No root or tampering found" : dev.overridden ? `Allowed for review: ${dev.reasons.join(" ") || "debug build"}` : dev.reasons.join(" ")} last={false} />
          <Row icon="lock" title="Server pinning" subtitle={pins.state === "on" ? `On for ${pins.hosts.join(", ")}` : pins.state === "error" ? `Problem: ${pins.detail}` : "Off in this build (no pins configured)"} />
          <Row icon="lock" title="Screenshots" subtitle="Blocked inside the app" last />
        </List>
      </Section>

      <Section title="Contracts" index={2}>
        <List>
          {Object.entries(contracts).length === 0 ? <Row title="No contracts linked" subtitle="Deploy, then run npm run sync:contracts" last /> :
            Object.entries(contracts).map(([k, a], i, arr) => (
              <Row key={k} title={k} subtitle={shortAddr(a)} onPress={() => Linking.openURL(addressUrl(a))} last={i === arr.length - 1} />
            ))}
        </List>
      </Section>

      <Section title="About" index={3}>
        <T v="footnote" color="textSecondary" style={{ marginLeft: 4 }}>JanSetu currently runs on a preview network (BNB Smart Chain Testnet). tINR is a preview token: it is not a rupee, cannot be cashed out and is not a stablecoin. Estimates are illustrations, never promises. The contracts are awaiting an independent audit.</T>
        <Button label="Remove wallet from this phone" variant="danger" onPress={() => setConfirm(true)} />
      </Section>

      <Sheet visible={confirm} onClose={() => setConfirm(false)}>
        <View style={{ gap: space.md }}>
          <T v="title2">Remove this wallet?</T>
          <T v="body" color="textSecondary">The key is erased from this phone. You can only get it back with your 12-word recovery phrase.</T>
          <Button label="Remove wallet" variant="danger" onPress={async () => { await remove(); setConfirm(false); router.replace("/welcome"); }} />
          <Button label="Keep it" variant="secondary" onPress={() => setConfirm(false)} />
        </View>
      </Sheet>
    </LargeTitleScreen>
  );
}
