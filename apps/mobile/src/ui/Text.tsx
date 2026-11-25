import { Text as RNText, type TextProps, type TextStyle } from "react-native";
import { type Colors, type TypeVariant, type, useColors } from "@/design/tokens";

export function T({ v = "body", color = "text", style, ...rest }: TextProps & { v?: TypeVariant; color?: keyof Colors; style?: TextStyle | TextStyle[] }) {
  const c = useColors();
  return <RNText allowFontScaling maxFontSizeMultiplier={1.3} {...rest} style={[type[v], { color: c[color] }, style]} />;
}
