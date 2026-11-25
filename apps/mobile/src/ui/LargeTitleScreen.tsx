import { type ReactNode } from "react";
import { useRef } from "react";
import { Animated, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { space, useColors } from "@/design/tokens";
import { T } from "./Text";
import { Icon } from "./Icon";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { useColorScheme } from "react-native";

const BAR = 48;

/** iOS-style large title that collapses into a compact bar as you scroll. */
export function LargeTitleScreen({ title, subtitle, back, right, children }: { title: string; subtitle?: string; back?: boolean; right?: ReactNode; children: ReactNode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const dark = useColorScheme() === "dark";
  const y = useRef(new Animated.Value(0)).current;
  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { y } } }], { useNativeDriver: true });
  const bar = { opacity: y.interpolate({ inputRange: [24, 64], outputRange: [0, 1], extrapolate: "clamp" }) };
  const large = { opacity: y.interpolate({ inputRange: [0, 48], outputRange: [1, 0], extrapolate: "clamp" }), transform: [{ translateY: y.interpolate({ inputRange: [0, 48], outputRange: [0, -6], extrapolate: "clamp" }) }] };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: 320 }}>
        <Svg width="100%" height={320}><Defs><RadialGradient id="aura" cx="50%" cy="0%" r="70%"><Stop offset="0" stopColor={c.tint} stopOpacity={dark ? 0.5 : 1} /><Stop offset="1" stopColor={c.bg} stopOpacity={0} /></RadialGradient></Defs><Rect width="100%" height={320} fill="url(#aura)" /></Svg>
      </View>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingTop: insets.top + BAR, paddingBottom: insets.bottom + 120, paddingHorizontal: space.lg }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View style={[{ paddingTop: space.sm, paddingBottom: space.lg }, large]}>
          <T v="largeTitle" accessibilityRole="header">{title}</T>
          {subtitle ? <T v="body" color="textSecondary" style={{ marginTop: 2 }}>{subtitle}</T> : null}
        </Animated.View>
        {children}
      </Animated.ScrollView>

      <View pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top + BAR }}>
        <Animated.View style={[{ position: "absolute", inset: 0, backgroundColor: c.bg, borderBottomWidth: 1, borderBottomColor: c.hairline }, bar]} />
        <View style={{ marginTop: insets.top, height: BAR, flexDirection: "row", alignItems: "center", paddingHorizontal: space.sm }}>
          <View style={{ width: 72 }}>
            {back ? (
              <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={({ pressed }) => ({ marginLeft: space.sm, width: 40, height: 40, borderRadius: 20, backgroundColor: c.surface, alignItems: "center", justifyContent: "center", elevation: 2, shadowColor: c.shadow, shadowOpacity: 1, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, transform: [{ scale: pressed ? 0.92 : 1 }] })}>
                <View style={{ transform: [{ rotate: "180deg" }] }}><Icon name="chevron" size={20} color={c.text} /></View>
              </Pressable>
            ) : null}
          </View>
          <Animated.View style={[{ flex: 1, alignItems: "center" }, bar]}><T v="headline" numberOfLines={1}>{title}</T></Animated.View>
          <View style={{ width: 72, alignItems: "flex-end", paddingRight: space.sm }}>{right}</View>
        </View>
      </View>
    </View>
  );
}
