import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radius, space, useColors } from "@/design/tokens";
import { duration, ease, springs, useMotion } from "@/design/motion";

/** Bottom sheet: scrim fades, panel rises on a critically damped spring (no bounce). */
export function Sheet({ visible, onClose, children, dismissable = true }: { visible: boolean; onClose: () => void; children: ReactNode; dismissable?: boolean }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { reduce, d } = useMotion();
  const [mounted, setMounted] = useState(visible);
  const y = useRef(new Animated.Value(520)).current;
  const o = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(o, { toValue: 1, duration: d(duration.base), easing: ease.out, useNativeDriver: true }).start();
      if (reduce) y.setValue(0); else Animated.spring(y, { toValue: 0, ...springs.sheet }).start();
      return;
    }
    Animated.timing(o, { toValue: 0, duration: d(duration.fast), easing: ease.in, useNativeDriver: true }).start();
    Animated.timing(y, { toValue: 520, duration: d(duration.fast), easing: ease.in, useNativeDriver: true }).start();
    const t = setTimeout(() => setMounted(false), duration.fast + 20);
    return () => clearTimeout(t);
  }, [visible, reduce, d, o, y]);

  const scrim = { opacity: o };
  const panel = { transform: [{ translateY: y }] };
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
