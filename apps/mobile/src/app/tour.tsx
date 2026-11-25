import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { space, useColors } from "@/design/tokens";
import { TOUR } from "@/content/help";
import { markTourSeen } from "@/lib/tour";
import { Button } from "@/ui/Button";
import { Logo } from "@/ui/Logo";
import { T } from "@/ui/Text";

export default function Tour() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [i, setI] = useState(0);
  const last = i === TOUR.length - 1;
  const close = async () => { await markTourSeen(); router.back(); };
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl, paddingHorizontal: space.xl }}>
      <View style={{ alignItems: "flex-end" }}><T v="callout" color="primary" onPress={close} accessibilityRole="button">Skip</T></View>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.lg }}>
        <Logo size={96} color={c.primary} animated />
        <View key={i} style={{ alignItems: "center", gap: space.md }}>
          <T v="title1" style={{ textAlign: "center" }}>{TOUR[i].title}</T>
          <T v="body" color="textSecondary" style={{ textAlign: "center" }}>{TOUR[i].body}</T>
        </View>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: space.xl }}>
        {TOUR.map((_, k) => <View key={k} style={{ width: k === i ? 20 : 8, height: 8, borderRadius: 4, backgroundColor: k === i ? c.primary : c.border }} />)}
      </View>
      <Button label={last ? "Get started" : "Next"} onPress={last ? close : () => setI(i + 1)} />
    </View>
  );
}
