import "@/wallet/polyfill";
import "@/lib/session";
import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { preventScreenCaptureAsync } from "expo-screen-capture";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts } from "@expo-google-fonts/inter";
import { Lora_500Medium, Lora_600SemiBold } from "@expo-google-fonts/lora";
import { WalletProvider } from "@/wallet/WalletProvider";
import { DataProvider } from "@/chain/DataProvider";
import { useColors } from "@/design/tokens";
import { setupPinning } from "@/security/pinning";
import { applyTheme, loadTheme } from "@/lib/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

/** If a screen throws, show what happened instead of closing the app. */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <View style={{ flex: 1, backgroundColor: "#F1EADB", padding: 24, justifyContent: "center", gap: 14 }}>
      <Text style={{ fontSize: 22, color: "#1B1A14" }}>Something went wrong</Text>
      <Text style={{ fontSize: 14, color: "#6E6A58" }}>Please send a screenshot of this screen to JanSetu support.</Text>
      <Text selectable style={{ fontSize: 12, color: "#B3443B" }}>{String(error?.message ?? error).slice(0, 600)}</Text>
      <Text selectable style={{ fontSize: 10, color: "#6E6A58" }}>{String(error?.stack ?? "").slice(0, 900)}</Text>
      <Pressable onPress={retry} style={{ backgroundColor: "#0A3D2C", borderRadius: 99, paddingVertical: 14, alignItems: "center" }}><Text style={{ color: "#F4EEDC", fontSize: 15 }}>Try again</Text></Pressable>
    </View>
  );
}

export default function RootLayout() {
  const c = useColors();
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Lora_500Medium, Lora_600SemiBold });

  useEffect(() => {
    // Security: no screenshots or screen recording, and a blank preview in the recent-apps switcher.
    preventScreenCaptureAsync().catch(() => {});
  }, []);
  useEffect(() => { setupPinning().catch(() => {}); }, []);
  useEffect(() => { loadTheme().then(applyTheme); }, []);
  useEffect(() => { if (fontsLoaded) SplashScreen.hideAsync().catch(() => {}); }, [fontsLoaded]);
  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <WalletProvider>
        <DataProvider>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: "slide_from_right" }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="tour" options={{ presentation: "modal", animation: "slide_from_bottom", gestureEnabled: false }} />
            <Stack.Screen name="welcome" options={{ animation: "fade", gestureEnabled: false }} />
          </Stack>
        </DataProvider>
      </WalletProvider>
    </SafeAreaProvider>
  );
}
