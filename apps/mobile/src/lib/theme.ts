import { Appearance } from "react-native";
import * as SecureStore from "expo-secure-store";

export type ThemeMode = "system" | "light" | "dark";
const KEY = "jansetu.theme";

export const applyTheme = (m: ThemeMode) => Appearance.setColorScheme(m === "system" ? "unspecified" : m);

export async function loadTheme(): Promise<ThemeMode> {
  try { const v = await SecureStore.getItemAsync(KEY); return v === "light" || v === "dark" ? v : "system"; } catch { return "system"; }
}

export async function saveTheme(m: ThemeMode) {
  applyTheme(m);
  try { await SecureStore.setItemAsync(KEY, m); } catch { /* the choice still applies until the app closes */ }
}
