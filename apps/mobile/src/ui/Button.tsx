import { ActivityIndicator, Pressable, View } from "react-native";
import * as Haptics from "expo-haptics";
import { radius, space, useColors } from "@/design/tokens";
import { T } from "./Text";

type Props = { label: string; onPress?: () => void; variant?: "primary" | "secondary" | "ghost" | "danger"; disabled?: boolean; loading?: boolean; compact?: boolean };

export function Button({ label, onPress, variant = "primary", disabled, loading, compact }: Props) {
  const c = useColors();
  const bg = variant === "primary" ? c.primary : variant === "danger" ? c.errorTint : variant === "secondary" ? c.surface : "transparent";
  const fg = variant === "primary" ? c.textOnPrimary : variant === "danger" ? c.error : c.tintText;
  const off = disabled || loading;
  return (
    <View style={{ opacity: off ? 0.5 : 1 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!off }}
        disabled={off}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); onPress?.(); }}
        style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }], backgroundColor: bg, borderRadius: 28, minHeight: compact ? 44 : 56, borderWidth: variant === "secondary" ? 1 : 0, borderColor: c.border, paddingHorizontal: space.xl, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space.sm })}
      >
        {loading ? <ActivityIndicator color={fg} /> : <T v="headline" style={{ color: fg }}>{label}</T>}
        <View />
      </Pressable>
    </View>
  );
}
