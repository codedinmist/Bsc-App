import { useEffect, useRef } from "react";
import { Animated, Linking, Pressable, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { radius, space, useColors } from "@/design/tokens";
import { duration, ease, useMotion, useTween } from "@/design/motion";
import { cancelPending, confirmPending, type TxState } from "@/chain/tx";
import { txUrl } from "@/chain/config";
import { Sheet } from "./Sheet";
import { T } from "./Text";
import { Button } from "./Button";
import { Logo } from "./Logo";
import { Icon } from "./Icon";
import { Chip } from "./Chip";

const R = 34, C = 2 * Math.PI * R, CHECK = 44;

function progressOf(s: TxState): number {
  if (s.phase === "success") return 1;
  const frac = { idle: 0, review: 0, authenticating: 0.1, simulating: 0.3, sending: 0.55, confirming: 0.8, failed: 0, success: 1 }[s.phase];
  return Math.min(0.98, (Math.max(0, s.step - 1) + frac) / Math.max(1, s.steps));
}

function Ring({ state }: { state: TxState }) {
  const c = useColors();
  const { d } = useMotion();
  const failed = state.phase === "failed", ok = state.phase === "success";
  const p = useTween(failed ? 1 : progressOf(state), d(duration.slow));
  const check = useTween(ok ? 1 : 0, d(duration.draw));
  const color = failed ? c.error : c.primary;
  return (
    <Svg width={96} height={96} viewBox="0 0 96 96">
      <Circle cx={48} cy={48} r={R} stroke={c.border} strokeWidth={5} fill="none" />
      <Circle cx={48} cy={48} r={R} stroke={color} strokeWidth={5} fill="none" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - p)} transform="rotate(-90 48 48)" />
      {ok && <Path d="M34 49 L44 59 L63 38" stroke={c.primary} strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={CHECK} strokeDashoffset={CHECK * (1 - check)} />}
      {failed && <Path d="M36 36 L60 60 M60 36 L36 60" stroke={c.error} strokeWidth={5} strokeLinecap="round" />}
    </Svg>
  );
}

/** App tile: the JanSetu mark on a green gradient, like the merchant tile at the top of an Apple Pay sheet. */
function AppTile({ size = 52 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: "#0A3D2C", alignItems: "center", justifyContent: "center" }}>
      <Logo size={size * 0.7} color="#F4EEDC" />
    </View>
  );
}

/** Pulsing fingerprint ring on the confirm button: the "look or touch to confirm" cue. */
function ConfirmCue() {
  const { reduce } = useMotion();
  const c = useColors();
  const o = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(o, { toValue: 1, duration: 900, easing: ease.inOut, useNativeDriver: true }),
      Animated.timing(o, { toValue: 0.55, duration: 900, easing: ease.inOut, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduce, o]);
  return <Animated.View style={{ opacity: o }}><Icon name="lock" size={22} color={c.textOnPrimary} /></Animated.View>;
}

const LABEL: Record<string, string> = {
  authenticating: "Confirm with fingerprint or face", simulating: "Checking the transaction", sending: "Sending to the network",
  confirming: "Waiting for network confirmation",
};

function Rows({ rows }: { rows: { label: string; value: string }[] }) {
  const c = useColors();
  return (
    <View style={{ backgroundColor: c.surfaceAlt, borderRadius: radius.md, overflow: "hidden", alignSelf: "stretch" }}>
      {rows.map((r, i) => (
        <View key={r.label} style={{ flexDirection: "row", justifyContent: "space-between", gap: space.lg, paddingVertical: 12, paddingHorizontal: space.lg, borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: c.hairline }}>
          <T v="footnote" color="textSecondary">{r.label}</T>
          <T v="footnote" style={{ flex: 1, textAlign: "right", fontFamily: "Inter_500Medium" }} numberOfLines={2}>{r.value}</T>
        </View>
      ))}
    </View>
  );
}

/**
 * Apple-Pay-style confirmation. Three moments:
 *  1. REVIEW   : who/what/how much, plus the fee, then one clear confirm button (nothing is sent before it).
 *  2. PROCESS  : progress ring while the phone authenticates and the network confirms.
 *  3. RESULT   : check mark with a success haptic, or a plain explanation of what went wrong.
 */
export function TxSheet({ state, onClose }: { state: TxState; onClose: () => void }) {
  const c = useColors();
  const review = state.phase === "review";
  const finished = state.phase === "success" || state.phase === "failed";
  useEffect(() => {
    if (state.phase === "success") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (state.phase === "failed") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    if (review) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
  }, [state.phase, review]);

  return (
    <Sheet visible={state.phase !== "idle"} onClose={() => (review ? cancelPending() : onClose())} dismissable={finished || review}>
      {review ? (
        <View style={{ gap: space.lg }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <AppTile />
            <View style={{ flex: 1, gap: 4 }}>
              <T v="headline">JanSetu</T>
              <Chip kind="testnet" label="Preview network · no cash value" />
            </View>
          </View>
          <View style={{ gap: 2 }}>
            <T v="footnote" color="textSecondary">You are about to</T>
            <T v="title1">{state.title}</T>
            {state.details?.amount ? (
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                <T v="money" style={{ fontVariant: ["tabular-nums"] }} numberOfLines={1} adjustsFontSizeToFit>{state.details.amount}</T>
                <T v="headline" color="textSecondary">{state.details.unit ?? "tINR"}</T>
              </View>
            ) : null}
          </View>
          {state.rows?.length ? <Rows rows={state.rows} /> : null}
          <View style={{ gap: space.sm }}>
            <ConfirmButton onPress={confirmPending} />
            <Button label="Cancel" variant="ghost" onPress={cancelPending} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Icon name="shield" size={14} color={c.textSecondary} />
            <T v="caption" color="textSecondary">Your phone asks for fingerprint or face next</T>
          </View>
        </View>
      ) : (
        <>
          <View style={{ alignItems: "center", gap: space.md, paddingVertical: space.md }}>
            <Ring state={state} />
            <T v="title2" style={{ textAlign: "center" }}>{state.phase === "success" ? "Done" : state.phase === "failed" ? "Not completed" : state.title}</T>
            <T v="body" color="textSecondary" style={{ textAlign: "center" }}>
              {state.phase === "success" ? "Done. Saved to the public record." : state.phase === "failed" ? state.error : LABEL[state.phase]}
            </T>
            {!finished && state.steps > 1 ? <T v="footnote" color="textSecondary">Step {state.step} of {state.steps} · {state.stepLabel}</T> : null}
            {state.phase === "success" && state.details?.amount ? <T v="headline" style={{ fontVariant: ["tabular-nums"] }}>{state.details.amount} {state.details.unit ?? "tINR"}</T> : null}
            {state.hash ? <T v="footnote" color="primary" onPress={() => Linking.openURL(txUrl(state.hash!))} accessibilityRole="link">View on BscScan</T> : null}
          </View>
          {finished ? <Button label="Close" onPress={onClose} variant={state.phase === "success" ? "primary" : "secondary"} /> : null}
        </>
      )}
    </Sheet>
  );
}


/** The confirm control: a full-width pill with the pulsing lock, like "Pay with Face ID". */
function ConfirmButton({ onPress }: { onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onPress(); }} accessibilityRole="button" accessibilityLabel="Confirm with fingerprint or face"
      style={({ pressed }) => ({ backgroundColor: c.primary, opacity: pressed ? 0.88 : 1, borderRadius: radius.pill, minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 })}>
      <ConfirmCue />
      <T v="headline" style={{ color: c.textOnPrimary }}>Confirm</T>
    </Pressable>
  );
}
