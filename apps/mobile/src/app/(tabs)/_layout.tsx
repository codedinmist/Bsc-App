import { View } from "react-native";
import { Redirect, Slot } from "expo-router";
import { useColors } from "@/design/tokens";
import { useWallet } from "@/wallet/WalletProvider";
import { FloatingTabBar } from "@/ui/FloatingTabBar";

/**
 * The five main screens share one simple frame: the current screen on top, the pill bar below.
 * No tab navigator and no screen detaching, so switching screens is just opening a screen.
 */
export default function TabsLayout() {
  const c = useColors();
  const { status } = useWallet();
  if (status === "none") return <Redirect href="/welcome" />;
  if (status === "loading") return null;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Slot />
      <FloatingTabBar />
    </View>
  );
}
