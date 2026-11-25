import { useMemo, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { usePreventScreenCapture } from "expo-screen-capture";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radius, space, useColors } from "@/design/tokens";
import { duration, ease } from "@/design/motion";
import { useWallet } from "@/wallet/WalletProvider";
import { canProtectKey } from "@/wallet/keystore";
import { T } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { Icon, type IconName } from "@/ui/Icon";
import { Logo } from "@/ui/Logo";
import { Banner } from "@/ui/parts";

type Mode = "intro" | "show" | "verify" | "restore";

/** Blocks screenshots and screen recording while it is mounted (the phrase is on screen). */
function NoScreenshots() { usePreventScreenCapture(); return null; }

/** App-icon style tile: rounded square, emerald gradient, white mark. */
function AppTile({ size = 92 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: "#0A3D2C", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#B08A3E55" }}>
      <Logo size={size * 0.66} color="#F4EEDC" animated />
    </View>
  );
}

function Feature({ icon, title, body, index }: { icon: IconName; title: string; body: string; index: number }) {
  const c = useColors();
  return (
    <Animated.View entering={FadeInDown.delay(180 + index * 90).duration(duration.slow).easing(ease.out)} style={{ flexDirection: "row", gap: space.lg, alignItems: "flex-start" }}>
      <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: c.tint, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={24} color={c.tintText} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T v="headline">{title}</T>
        <T v="footnote" color="textSecondary">{body}</T>
      </View>
    </Animated.View>
  );
}

function Steps({ step }: { step: 1 | 2 }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
      {[1, 2].map((n) => <View key={n} style={{ height: 4, width: n === step ? 28 : 14, borderRadius: 2, backgroundColor: n <= step ? c.primary : c.border }} />)}
      <T v="caption" color="textSecondary" style={{ marginLeft: 6 }}>Step {step} of 2</T>
    </View>
  );
}

function WordRow({ n, word, shown, last }: { n: number; word: string; shown: boolean; last: boolean }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, paddingHorizontal: 14, borderBottomWidth: last ? 0 : 0.5, borderBottomColor: c.hairline }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c.tint, alignItems: "center", justifyContent: "center" }}>
        <T v="caption" style={{ color: c.tintText, fontFamily: "Inter_600SemiBold" }}>{n}</T>
      </View>
      <T v="headline" style={{ fontVariant: ["tabular-nums"], letterSpacing: shown ? -0.2 : 2 }} accessibilityElementsHidden={!shown} importantForAccessibility={shown ? "yes" : "no-hide-descendants"}>{shown ? word : "••••••"}</T>
    </View>
  );
}

export default function Welcome() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { create, restore } = useWallet();
  const [mode, setMode] = useState<Mode>("intro");
  const [phrase, setPhrase] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [picked, setPicked] = useState<(string | null)[]>([null, null, null]);
  const [input, setInput] = useState("");

  const words = useMemo(() => phrase.split(" ").filter(Boolean), [phrase]);
  const check = useMemo(() => [2, 6, 10], []); // ask for words #3, #7, #11
  /** Each question: the right word plus three other words from the same phrase, in a random order. */
  const options = useMemo(() => check.map((idx) => {
    const others = words.filter((_, i) => i !== idx && words[i] !== words[idx]);
    const decoys = [...others].sort(() => Math.random() - 0.5).slice(0, 3);
    return [words[idx], ...decoys].filter(Boolean).sort(() => Math.random() - 0.5);
  }), [words, check]);

  const doCreate = async () => {
    setErr(undefined); setBusy(true);
    await new Promise((r) => setTimeout(r, 60)); // let the spinner draw before the heavy key maths starts
    try { setPhrase(await create()); setShown(false); setPicked([null, null, null]); setMode("show"); } catch (e) { setErr(e instanceof Error ? e.message : "Could not create the wallet."); } finally { setBusy(false); }
  };
  const doRestore = async () => {
    setErr(undefined); setBusy(true);
    await new Promise((r) => setTimeout(r, 60));
    try { await restore(input); router.replace("/"); } catch (e) { setErr(e instanceof Error ? e.message : "Could not restore."); } finally { setBusy(false); }
  };
  const verified = check.every((idx, k) => picked[k] === words[idx]);
  const pick = (k: number, w: string) => { Haptics.selectionAsync(); setPicked((p) => p.map((x, j) => (j === k ? w : x))); };

  const footer = (
    <View style={{ paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: insets.bottom + space.lg, gap: space.sm, backgroundColor: c.bg }}>
      {mode === "intro" && (<>
        <Button label="Create my wallet" onPress={doCreate} loading={busy} />
        <Button label="I already have a recovery phrase" variant="ghost" onPress={() => setMode("restore")} />
      </>)}
      {mode === "show" && <Button label={shown ? "I wrote it down" : "Reveal the words to continue"} disabled={!shown} onPress={() => { setShown(false); setMode("verify"); }} />}
      {mode === "verify" && (<>
        <Button label="Continue" disabled={!verified} onPress={() => router.replace("/")} />
        <Button label="Show the words again" variant="ghost" onPress={() => { setPicked([null, null, null]); setMode("show"); }} />
      </>)}
      {mode === "restore" && (<>
        <Button label="Restore wallet" onPress={doRestore} loading={busy} disabled={input.trim().split(/\s+/).length < 12} />
        <Button label="Back" variant="ghost" onPress={() => { setErr(undefined); setMode("intro"); }} />
      </>)}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {mode === "show" && shown && <NoScreenshots />}
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, paddingTop: insets.top + space.xxl, paddingBottom: space.xl, gap: space.xl, flexGrow: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {mode === "intro" && (
          <>
            <Animated.View entering={FadeIn.duration(duration.slow).easing(ease.out)} style={{ alignItems: "center", gap: space.lg, paddingTop: space.xl }}>
              <AppTile />
              <View style={{ alignItems: "center", gap: 6 }}>
                <T v="largeTitle" style={{ textAlign: "center" }}>Welcome to JanSetu</T>
                <T v="body" color="textSecondary" style={{ textAlign: "center", maxWidth: 300 }}>Simple savings and local cash services, on a public record you can check yourself.</T>
              </View>
              <View style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: c.warningTint }}>
                <T v="caption" style={{ color: c.warning, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8 }}>PREVIEW NETWORK</T>
              </View>
            </Animated.View>
            <View style={{ gap: space.xl, paddingTop: space.md }}>
              <Feature index={0} icon="shield" title="You hold the keys" body="Your wallet lives on this phone, locked with your fingerprint, face or PIN. Nobody else can move your money." />
              <Feature index={1} icon="savings" title="Save in small steps" body="Daily, recurring and fixed deposits. Your savings stay visible and yours." />
              <Feature index={2} icon="bridge" title="Cash with local agents" body="Put cash in and take it out through verified agents near you." />
            </View>
            {busy ? <Banner title="Creating your wallet" body="This can take up to a minute on an older phone. Please keep the app open." /> : null}
            {err ? <Banner kind="error" title="Couldn't continue" body={err} /> : null}
          </>
        )}

        {mode === "show" && (
          <Animated.View entering={FadeIn.duration(duration.base).easing(ease.out)} style={{ gap: space.xl }}>
            <View style={{ gap: space.md }}>
              <Steps step={1} />
              <T v="title1">Your recovery phrase</T>
              <T v="body" color="textSecondary">These 12 words are the only way to get your wallet back if you lose this phone. Write them on paper, in order.</T>
            </View>

            <View style={{ backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 0.5, borderColor: c.border, overflow: "hidden" }}>
              <View style={{ flexDirection: "row" }}>
                {[0, 1].map((col) => (
                  <View key={col} style={{ flex: 1, borderLeftWidth: col ? 0.5 : 0, borderLeftColor: c.hairline }}>
                    {words.slice(col * 6, col * 6 + 6).map((w, i) => <WordRow key={i} n={col * 6 + i + 1} word={w} shown={shown} last={i === 5} />)}
                  </View>
                ))}
              </View>
              {!shown && (
                <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShown(true); }} accessibilityRole="button" accessibilityLabel="Reveal recovery phrase"
                  style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: c.surface + "F2", alignItems: "center", justifyContent: "center", gap: 10 }}>
                  <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.tint, alignItems: "center", justifyContent: "center" }}>
                    <Icon name="lock" size={28} color={c.tintText} />
                  </View>
                  <T v="headline">Tap to reveal</T>
                  <T v="footnote" color="textSecondary" style={{ textAlign: "center", paddingHorizontal: 32 }}>Make sure nobody is looking at your screen.</T>
                </Pressable>
              )}
            </View>

            <View style={{ backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 0.5, borderColor: c.border }}>
              {([
                ["book", "Write it on paper", "Not in notes, messages or photos. Screenshots are blocked while the words are showing."],
                ["shield", "Never share it", "JanSetu will never ask for these words. Anyone who has them can take your money."],
                ["alert", "We cannot recover it", "JanSetu does not store your phrase. Lose the phrase and the phone, and the wallet is gone."],
              ] as [IconName, string, string][]).map(([icon, title, body], i, a) => (
                <View key={title} style={{ flexDirection: "row", gap: space.md, padding: space.lg, borderBottomWidth: i === a.length - 1 ? 0 : 0.5, borderBottomColor: c.hairline }}>
                  <Icon name={icon} size={22} color={icon === "alert" ? c.warning : c.tintText} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <T v="callout" style={{ fontFamily: "Inter_600SemiBold" }}>{title}</T>
                    <T v="footnote" color="textSecondary">{body}</T>
                  </View>
                </View>
              ))}
            </View>
          </Animated.View>
        )}

        {mode === "verify" && (
          <Animated.View entering={FadeIn.duration(duration.base).easing(ease.out)} style={{ gap: space.xl }}>
            <View style={{ gap: space.md }}>
              <Steps step={2} />
              <T v="title1">Check your paper</T>
              <T v="body" color="textSecondary">Tap the right word for each number. This proves you wrote the phrase down correctly.</T>
            </View>
            {check.map((idx, k) => (
              <View key={idx} style={{ gap: space.sm }}>
                <T v="headline">Word #{idx + 1}</T>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                  {options[k].map((w) => {
                    const on = picked[k] === w;
                    const ok = on && w === words[idx];
                    const bad = on && !ok;
                    return (
                      <Pressable key={w} onPress={() => pick(k, w)} accessibilityRole="button" accessibilityState={{ selected: on }}
                        style={{ width: "48.5%", minHeight: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6,
                          backgroundColor: ok ? c.tint : bad ? c.errorTint : c.surface, borderWidth: 1.5, borderColor: ok ? c.primary : bad ? c.error : c.border }}>
                        <T v="headline" style={{ color: ok ? c.tintText : bad ? c.error : c.text }}>{w}</T>
                        {ok ? <Icon name="check" size={18} color={c.tintText} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
                {picked[k] && picked[k] !== words[idx] ? <T v="footnote" style={{ color: c.error }}>Not quite. Check your paper and try again.</T> : null}
              </View>
            ))}
          </Animated.View>
        )}

        {mode === "restore" && (
          <Animated.View entering={FadeIn.duration(duration.base).easing(ease.out)} style={{ gap: space.xl }}>
            <View style={{ gap: space.md }}>
              <T v="title1">Restore your wallet</T>
              <T v="body" color="textSecondary">Type your 12 recovery words in order, with a space between each.</T>
            </View>
            <TextInput value={input} onChangeText={setInput} multiline autoCapitalize="none" autoCorrect={false} secureTextEntry={false} textContentType="none" importantForAutofill="no"
              placeholder="word1 word2 word3 …" placeholderTextColor={c.textSecondary}
              style={{ minHeight: 150, textAlignVertical: "top", backgroundColor: c.surface, borderWidth: 0.5, borderColor: c.border, borderRadius: radius.lg, padding: space.lg, fontFamily: "Inter_500Medium", fontSize: 18, lineHeight: 28, color: c.text }} />
            <T v="footnote" color="textSecondary">{Math.min(12, input.trim() ? input.trim().split(/\s+/).length : 0)} of 12 words</T>
            {busy ? <Banner title="Restoring your wallet" body="This can take up to a minute on an older phone." /> : null}
            {err ? <Banner kind="error" title="Couldn't restore" body={err} /> : null}
          </Animated.View>
        )}
      </ScrollView>
      {footer}
    </View>
  );
}
