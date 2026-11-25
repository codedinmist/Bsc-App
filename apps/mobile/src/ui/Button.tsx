import { ActivityIndicator, Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { radius, space, useColors } from "@/design/tokens";
import { ease, springs, useMotion } from "@/design/motion";
import { T } from "./Text";

type Props = { label: string; onPress?: () => void; variant?: "primary" | "secondary" | "ghost" | "danger"; disabled?: boolean; loading?: boolean; compact?: boolean };

export function Button({ label, onPress, variant = "primary", disabled, loading, compact }: Props) {
  const c = useColors();
  const { reduce } = useMotion();
  const s = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  const bg = variant === "primary" ? c.primary : variant === "danger" ? c.errorTint : variant === "secondary" ? c.surface : "transparent";
  const fg = variant === "primary" ? c.textOnPrimary : variant === "danger" ? c.error : c.tintText;
  const off = disabled || loading;
  return (
    <Animated.View style={[style, { opacity: off ? 0.5 : 1 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!off }}
        disabled={off}
        onPressIn={() => { s.value = reduce ? withTiming(1, { duration: 1 }) : withSpring(0.98, springs.press); }}
        onPressOut={() => { s.value = withTiming(1, { duration: 160, easing: ease.out }); }}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress?.(); }}
        style={{ backgroundColor: bg, borderRadius: 28, minHeight: compact ? 44 : 56, borderWidth: variant === "secondary" ? 1 : 0, borderColor: c.border, paddingHorizontal: space.xl, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space.sm }}
      >
        {loading ? <ActivityIndicator color={fg} /> : <T v="headline" style={{ color: fg }}>{label}</T>}
        <View />
      </Pressable>
    </Animated.View>
  );
}
