import { Pressable, View, useColorScheme } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "./Icon";
import { T } from "./Text";

const TABS: { path: "/" | "/savings" | "/pay" | "/credit" | "/more"; label: string; icon: IconName }[] = [
  { path: "/", label: "Home", icon: "home" },
  { path: "/savings", label: "Save", icon: "savings" },
  { path: "/pay", label: "Pay", icon: "pay" },
  { path: "/credit", label: "Borrow", icon: "credit" },
  { path: "/more", label: "More", icon: "more" },
];

/** Plain views and plain taps only. Nothing animated, no haptics, so tapping the bar cannot trip anything native. */
function Item({ label, icon, on, onPress }: { label: string; icon: IconName; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }} hitSlop={4}
      style={{ height: 46, width: on ? 112 : 46, borderRadius: 23, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: on ? "rgba(255,255,255,0.14)" : "transparent" }}>
      <Icon name={icon} size={22} color={on ? "#FFFFFF" : "#8A978E"} strokeWidth={on ? 2.1 : 1.8} />
      {on ? <T v="callout" numberOfLines={1} style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 14 }}>{label}</T> : null}
    </Pressable>
  );
}

const isOn = (pathname: string, path: string) => (path === "/" ? pathname === "/" || pathname === "/index" : pathname === path || pathname.startsWith(path + "/"));

/** Floating pill. The active tab grows to show its name. */
export function FloatingTabBar() {
  const insets = useSafeAreaInsets();
  const dark = useColorScheme() === "dark";
  const router = useRouter();
  const pathname = usePathname();
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 20, right: 20, bottom: Math.max(insets.bottom, 12) + 8 }}>
      <View style={{ height: 64, borderRadius: 32, backgroundColor: dark ? "#1F2A24" : "#10201A", flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 9, elevation: 10, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 18, shadowOffset: { width: 0, height: 10 } }}>
        {TABS.map((t) => {
          const on = isOn(pathname, t.path);
          return <Item key={t.path} label={t.label} icon={t.icon} on={on} onPress={() => { if (!on) router.navigate(t.path); }} />;
        })}
      </View>
    </View>
  );
}
