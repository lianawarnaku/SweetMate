import { View, StyleSheet, type ViewProps } from "react-native";
import { BlurView } from "expo-blur";
import { useAppContextSelector } from "@/context/AppContext";
import { useTheme } from "@/constants/colors";

// Renders a frosted-glass card when the "Black & White" scheme is active,
// falling back to a flat colored card for the other (light) schemes.
export function Surface({ style, children, ...rest }: ViewProps) {
  const colorScheme = useAppContextSelector((context) => context.colorScheme);
  const colors = useTheme();
  const isGlass = colorScheme === "mono";

  if (!isGlass) {
    return (
      <View style={[{ backgroundColor: colors.card }, style]} {...rest}>
        {children}
      </View>
    );
  }

  return (
    <View style={[styles.clip, style]} {...rest}>
      <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFillObject} />
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.card }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
});
