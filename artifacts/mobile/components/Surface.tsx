import { View, StyleSheet, type ViewProps } from "react-native";
import { BlurView } from "expo-blur";
import { useAppContextSelector } from "@/context/AppContext";
import { useTheme } from "@/constants/colors";
import { glass, type GlassLevel } from "@/constants/designTokens";

type SurfaceProps = ViewProps & {
  /** Visual elevation in the glass hierarchy. Defaults to the existing card treatment. */
  level?: GlassLevel;
};

// Renders a frosted-glass card when the "Black & White" scheme is active,
// falling back to a flat colored card for the other (light) schemes.
export function Surface({ style, children, level = "card", ...rest }: SurfaceProps) {
  const colorScheme = useAppContextSelector((context) => context.colorScheme);
  const colors = useTheme();
  const isGlass = colorScheme === "mono";
  const treatment = glass[level];

  if (!isGlass) {
    return (
      <View
        style={[
          styles.base,
          {
            backgroundColor: level === "subtle" ? colors.muted : colors.card,
            borderColor: colors.border,
            shadowOpacity: treatment.shadowOpacity,
            shadowRadius: treatment.shadowRadius,
            elevation: treatment.elevation,
          },
          style,
        ]}
        {...rest}
      >
        {children}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.base,
        {
          borderColor: treatment.borderColor,
          shadowOpacity: treatment.shadowOpacity,
          shadowRadius: treatment.shadowRadius,
          elevation: treatment.elevation,
        },
        style,
      ]}
      {...rest}
    >
      <BlurView
        intensity={treatment.blurIntensity}
        tint="dark"
        style={StyleSheet.absoluteFillObject}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: treatment.darkTint },
        ]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
  },
});
