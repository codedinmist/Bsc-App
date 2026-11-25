import { useEffect, useState, type ReactNode } from "react";
import { Modal, Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radius, space, useColors } from "@/design/tokens";
import { duration, ease, springs, useMotion } from "@/design/motion";

/** Bottom sheet: scrim fades, panel rises on a critically damped spring (no bounce). */
export function Sheet({ visible, onClose, children, dismissable = true }: { visible: boolean; onClose: () => void; children: ReactNode; dismissable?: boolean }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { reduce, d } = useMotion();
  const [mounted, setMounted] = useState(visible);
  const y = useSharedValue(520);
  const o = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      o.value = withTiming(1, { duration: d(duration.base), easing: ease.out });
      y.value = reduce ? withTiming(0, { duration: 1 }) : withSpring(0, springs.sheet);
      return;
    }
    o.value = withTiming(0, { duration: d(duration.fast), easing: ease.in });
    y.value = withTiming(520, { duration: d(duration.fast), easing: ease.in });
    const t = setTimeout(() => setMounted(false), duration.fast + 20);
    return () => clearTimeout(t);
  }, [visible, reduce, d, o, y]);

  const scrim = useAnimatedStyle(() => ({ opacity: o.value }));
  const panel = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  if (!mounted) return null;
  return (
    <Modal transparent visible animationType="none" onRequestClose={() => { if (dismissable) onClose(); }} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Animated.View style={[{ position: "absolute", inset: 0, backgroundColor: c.overlay }, scrim]}>
          <Pressable style={{ flex: 1 }} onPress={() => dismissable && onClose()} accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View style={[{ backgroundColor: c.surface, borderTopLeftRadius: 34, borderTopRightRadius: 34, padding: space.xl, paddingBottom: space.xl + insets.bottom }, panel]}>
          <View style={{ alignSelf: "center", width: 42, height: 5, borderRadius: 3, backgroundColor: c.border, marginBottom: space.lg }} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}
