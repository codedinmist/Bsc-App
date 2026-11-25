import { Redirect, Tabs } from "expo-router";
import { useColors } from "@/design/tokens";
import { useWallet } from "@/wallet/WalletProvider";
import { FloatingTabBar } from "@/ui/FloatingTabBar";

export default function TabsLayout() {
  const c = useColors();
  const { status } = useWallet();
  if (status === "none") return <Redirect href="/welcome" />;
  if (status === "loading") return null;
  return (
    <Tabs
      tabBar={(p) => <FloatingTabBar {...p} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.bg } }}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="savings" options={{ title: "Save" }} />
      <Tabs.Screen name="pay" options={{ title: "Pay" }} />
      <Tabs.Screen name="credit" options={{ title: "Borrow" }} />
      <Tabs.Screen name="more" options={{ title: "More" }} />
    </Tabs>
  );
}
