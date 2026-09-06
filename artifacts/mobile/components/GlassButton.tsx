import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

import { AccentButton, GlassSurface } from "@/components/LiquidGlass";
import { interaction, radii, spacing } from "@/constants/designTokens";

type GlassButtonTone = "primary" | "neutral" | "destructive";
type GlassButtonProps = Omit<PressableProps, "children" | "style"> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: GlassButtonTone;
};

export function GlassButton({
  children,
  style,
  tone = "primary",
  disabled,
  accessibilityRole = "button",
  accessibilityState,
  hitSlop = 4,
  ...props
}: GlassButtonProps) {
  if (tone === "primary") {
    return (
      <AccentButton
        {...props}
        accessibilityRole={accessibilityRole}
        accessibilityState={{ ...accessibilityState, disabled: Boolean(disabled) }}
        hitSlop={hitSlop}
        disabled={disabled}
        style={style}
      >
        {children}
      </AccentButton>
    );
  }
  return (
    <Pressable
      {...props}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ ...accessibilityState, disabled: Boolean(disabled) }}
      hitSlop={hitSlop}
      style={({ pressed }) => [
        styles.button,
        style,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <GlassSurface interactive variant={tone === "destructive" ? "destructive" : "elevated"} style={StyleSheet.absoluteFill} />
      <View style={styles.content}>{children}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: interaction.comfortableTouchTarget, borderRadius: radii.pill, overflow: "hidden", shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.18, shadowRadius: 14, elevation: 7 },
  content: { flex: 1, minHeight: interaction.comfortableTouchTarget, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  disabled: { opacity: interaction.disabledOpacity },
  pressed: { opacity: 0.84, transform: [{ scale: interaction.pressedScale }] },
});
