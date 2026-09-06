import type { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useTheme } from "@/constants/colors";
import { GlassSheet } from "@/components/LiquidGlass";
import { elevation } from "@/constants/designTokens";

export function GlassModalBackdrop({
  onPress,
  accessibilityLabel = "Close popup",
}: {
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const colors = useTheme();
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop }]} />
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
  destructive = false,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  destructive?: boolean;
}) {
  const colors = useTheme();

  return (
    <GlassSheet variant={destructive ? "destructive" : "modal"} style={[styles.surface, { borderColor: destructive ? colors.destructive : colors.glassRim }, style]}>
      {children}
    </GlassSheet>
  );
}

const styles = StyleSheet.create({
  surface: {
    overflow: "hidden",
    borderWidth: 1,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: elevation.modal.shadowOpacity,
    shadowRadius: elevation.modal.shadowRadius,
    elevation: elevation.modal.elevation,
  },
});
