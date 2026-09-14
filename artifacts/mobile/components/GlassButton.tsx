import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

import { AccentButton } from "@/components/LiquidGlass";
import { useTheme } from "@/constants/colors";
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
  const colors = useTheme();
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
        { backgroundColor: tone === "destructive" ? colors.destructive : colors.surfaceElevated, borderColor: colors.divider },
        style,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <View style={styles.content}>{children}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: interaction.comfortableTouchTarget, borderRadius: radii.pill, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
  content: { flex: 1, minHeight: interaction.comfortableTouchTarget, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  disabled: { opacity: interaction.disabledOpacity },
  pressed: { opacity: 0.84, transform: [{ scale: interaction.pressedScale }] },
});
