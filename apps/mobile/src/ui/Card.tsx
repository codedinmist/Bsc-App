import { View, type ViewProps } from "react-native";
import { radius, space, useColors } from "@/design/tokens";

export function Card({ style, padded = true, ...rest }: ViewProps & { padded?: boolean }) {
  const c = useColors();
  return (
    <View
      {...rest}
      style={[
        { backgroundColor: c.surface, borderRadius: 28, padding: padded ? space.lg : 0,
          shadowColor: c.shadow, shadowOpacity: 1, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 1 },
        style,
      ]}
    />
  );
}
