import { useColorScheme } from "react-native";

export const palette = {
  light: {
    bg: "#F1EADB", surface: "#FAF6EC", surfaceAlt: "#E8E0CB", border: "#E0D7C0", hairline: "#E6DEC8",
    text: "#1B1A14", textSecondary: "#6E6A58", textOnPrimary: "#FFFFFF",
    primary: "#0A3D2C", emerald: "#1C7A4D", tint: "#E3E8D5", tintText: "#0A3D2C",
    success: "#1C7A4D", warning: "#8A5A00", warningTint: "#F6E6BE", error: "#B3443B", errorTint: "#F4DDD6",
    overlay: "rgba(20,18,10,0.5)", shadow: "rgba(70,55,20,0.10)",
  },
  dark: {
    bg: "#0F1311", surface: "#181D1A", surfaceAlt: "#1E2420", border: "#262C28", hairline: "#20261F",
    text: "#F2F0E8", textSecondary: "#98A196", textOnPrimary: "#06261A",
    primary: "#3DBE86", emerald: "#3DBE86", tint: "#1B2B23", tintText: "#7FE0B6",
    success: "#3DBE86", warning: "#F4C46A", warningTint: "#3A2E12", error: "#E0786F", errorTint: "#2E1613",
    overlay: "rgba(0,0,0,0.6)", shadow: "rgba(0,0,0,0.4)",
  },
} as const;

export type Colors = { [K in keyof typeof palette.light]: string };

export function useColors(): Colors {
  return palette[useColorScheme() === "dark" ? "dark" : "light"];
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 } as const;
export const radius = { sm: 12, md: 18, lg: 24, xl: 30, pill: 999 } as const;

/** Lora (serif) for headings and money, Inter for everything else. */
export const type = {
  largeTitle: { fontFamily: "Lora_500Medium", fontSize: 32, lineHeight: 40, letterSpacing: -0.5 },
  title1: { fontFamily: "Lora_500Medium", fontSize: 27, lineHeight: 34, letterSpacing: -0.4 },
  title2: { fontFamily: "Lora_500Medium", fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  headline: { fontFamily: "Inter_600SemiBold", fontSize: 16, lineHeight: 22, letterSpacing: -0.2 },
  body: { fontFamily: "Inter_400Regular", fontSize: 15, lineHeight: 23, letterSpacing: -0.1 },
  callout: { fontFamily: "Inter_500Medium", fontSize: 15, lineHeight: 21, letterSpacing: -0.1 },
  footnote: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18, letterSpacing: 0 },
  caption: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 16, letterSpacing: 0.2 },
  money: { fontFamily: "Lora_500Medium", fontSize: 40, lineHeight: 48, letterSpacing: -0.8 },
} as const;
export type TypeVariant = keyof typeof type;
