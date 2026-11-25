import { Pressable, View, useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Icon, type IconName } from "./Icon";
import { T } from "./Text";

const ICONS: Record<string, IconName> = { index: "home", savings: "savings", pay: "pay", credit: "credit", more: "more" };

/** Plain views only. No animated styles here, so tapping a tab can never trip the animation engine. */
function Item({ label, icon, on, onPress }: { label: string; icon: IconName; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: on }} hitSlop={4}
      style={{ height: 46, width: on ? 112 : 46, borderRadius: 23, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: on ? "rgba(255,255,255,0.14)" : "transparent" }}>
      <Icon name={icon} size={22} color={on ? "#FFFFFF" : "#8A978E"} strokeWidth={on ? 2.1 : 1.8} />
      {on ? <T v="callout" numberOfLines={1} style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 14 }}>{label}</T> : null}
    </Pressable>
  );
}

/** Floating pill. The active tab grows to show its name. */
export function FloatingTabBar({ state, descriptors, navigation }: any) {
  const insets = useSafeAreaInsets();
  const dark = useColorScheme() === "dark";
  const routes = state.routes.filter((r: any) => descriptors[r.key].options.href !== null);
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 20, right: 20, bottom: Math.max(insets.bottom, 12) + 8 }}>
      <View style={{ height: 64, borderRadius: 32, backgroundColor: dark ? "#1F2A24" : "#10201A", flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 9, elevation: 10, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 18, shadowOffset: { width: 0, height: 10 } }}>
        {routes.map((r: any) => {
          const on = state.routes[state.index].key === r.key;
          const label = descriptors[r.key].options.title ?? r.name;
          return <Item key={r.key} label={label} icon={ICONS[r.name] ?? "more"} on={on} onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            const e = navigation.emit({ type: "tabPress", target: r.key, canPreventDefault: true });
            if (!on && !e.defaultPrevented) navigation.navigate(r.name);
          }} />;
        })}
      </View>
    </View>
  );
}
