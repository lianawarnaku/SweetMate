import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

import { AccentButton, GlassSurface } from "@/components/LiquidGlass";

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
  button: { minHeight: 50, borderRadius: 25, overflow: "hidden", shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.2, shadowRadius: 14, elevation: 7 },
  content: { flex: 1, minHeight: 48, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.84, transform: [{ scale: 0.985 }] },
});
