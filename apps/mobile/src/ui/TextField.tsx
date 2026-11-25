import { TextInput, View, type TextInputProps } from "react-native";
import { radius, space, useColors } from "@/design/tokens";
import { T } from "./Text";

export function TextField({ label, ...props }: TextInputProps & { label?: string }) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      {label ? <T v="footnote" color="textSecondary" style={{ marginLeft: 4 }}>{label}</T> : null}
      <TextInput autoCapitalize="none" autoCorrect={false} placeholderTextColor={c.textSecondary} accessibilityLabel={label} {...props}
        style={[{ backgroundColor: c.surfaceAlt, borderRadius: radius.md, paddingHorizontal: space.lg, minHeight: 52, fontFamily: "Inter_500Medium", fontSize: 15, color: c.text }, props.style]} />
    </View>
  );
}
