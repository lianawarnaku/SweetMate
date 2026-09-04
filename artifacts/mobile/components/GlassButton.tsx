import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

type GlassButtonTone = "primary" | "neutral" | "destructive";

type GlassButtonProps = Omit<PressableProps, "children" | "style"> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: GlassButtonTone;
};

const GLOWS: Record<GlassButtonTone, readonly [string, string, string]> = {
  primary: ["rgba(177,238,116,0.42)", "rgba(132,221,190,0.28)", "rgba(127,211,235,0.38)"],
  neutral: ["rgba(255,255,255,0.13)", "rgba(210,224,220,0.08)", "rgba(255,255,255,0.11)"],
  destructive: ["rgba(255,94,89,0.38)", "rgba(205,55,65,0.25)", "rgba(255,140,105,0.28)"],
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
      <BlurView intensity={58} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, styles.darkBase]} />
      <LinearGradient
        colors={GLOWS[tone]}
        start={{ x: 0, y: 0.9 }}
        end={{ x: 1, y: 0.15 }}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.highlight} />
      <View style={styles.content}>{children}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 50,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 7,
  },
  darkBase: { backgroundColor: "rgba(13,15,15,0.72)" },
  highlight: {
    position: "absolute",
    left: 18,
    right: 18,
    top: 0,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.42)",
  },
  content: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.84, transform: [{ scale: 0.985 }] },
});
