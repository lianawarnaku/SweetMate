import { BlurView } from "expo-blur";
import type { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useTheme } from "@/constants/colors";
import { useAppContextSelector } from "@/context/AppContext";

export function GlassModalBackdrop({
  onPress,
  accessibilityLabel = "Close popup",
}: {
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, styles.backdropTint]} />
      <Pressable
        accessibilityRole={onPress ? "button" : undefined}
        accessibilityLabel={onPress ? accessibilityLabel : undefined}
        disabled={!onPress}
        onPress={onPress}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

export function GlassModalSurface({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useTheme();
  const colorScheme = useAppContextSelector((context) => context.colorScheme);
  const dark = colorScheme === "mono";

  return (
    <View style={[styles.surface, { borderColor: colors.border }, style]}>
      <BlurView
        intensity={76}
        tint={dark ? "dark" : "light"}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          dark ? styles.darkTint : styles.lightTint,
        ]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  backdropTint: { backgroundColor: "rgba(0,0,0,0.38)" },
  surface: {
    overflow: "hidden",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 30,
    elevation: 18,
  },
  darkTint: { backgroundColor: "rgba(18,20,21,0.7)" },
  lightTint: { backgroundColor: "rgba(255,252,248,0.7)" },
});
