import { View } from "react-native";
import { radius, useColors } from "@/design/tokens";
import { T } from "./Text";

export type ChipKind = "testnet" | "simulated" | "projected" | "success" | "warning" | "info" | "error";

export function Chip({ kind = "info", label }: { kind?: ChipKind; label: string }) {
  const c = useColors();
  const map = {
    testnet: [c.warningTint, c.warning], simulated: [c.surfaceAlt, c.textSecondary], projected: [c.surfaceAlt, c.textSecondary],
    success: [c.tint, c.tintText], warning: [c.warningTint, c.warning], info: [c.tint, c.tintText], error: [c.errorTint, c.error],
  } as const;
  const [bg, fg] = map[kind];
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" }}>
      <T v="caption" style={{ color: fg }}>{label}</T>
    </View>
  );
}
