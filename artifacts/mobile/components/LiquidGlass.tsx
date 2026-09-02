import { BlurView } from "expo-blur";
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import React, { type ReactNode, useEffect, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewProps, type ViewStyle } from "react-native";

import { useTheme } from "@/constants/colors";

type GlassVariant = "regular" | "elevated" | "destructive";

function useReduceTransparency() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then((value) => {
      if (active) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceTransparencyChanged", setReduced);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

export function GlassSurface({ children, style, variant = "regular", interactive = false, ...props }: ViewProps & { variant?: GlassVariant; interactive?: boolean }) {
  const colors = useTheme();
  const reduceTransparency = useReduceTransparency();
  const nativeGlass = Platform.OS === "ios" && !reduceTransparency && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
  const baseColor = variant === "destructive" ? colors.destructiveSurface : variant === "elevated" ? colors.surfaceElevated : colors.surface;

  if (nativeGlass) {
    return (
      <GlassView {...props} colorScheme={colors.mode} glassEffectStyle="regular" isInteractive={interactive} tintColor={variant === "destructive" ? colors.destructive : colors.accent} style={[styles.clip, { borderColor: colors.glassRim }, style]}>
        {children}
      </GlassView>
    );
  }
  if (reduceTransparency) {
    return <View {...props} style={[styles.clip, { backgroundColor: baseColor, borderColor: colors.divider }, style]}>{children}</View>;
  }
  return (
    <View {...props} style={[styles.clip, { borderColor: colors.glassRim }, style]}>
      <BlurView intensity={variant === "elevated" ? 78 : 58} tint={colors.mode} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: baseColor }]} />
      <LinearGradient pointerEvents="none" colors={[`${variant === "destructive" ? colors.destructive : colors.accent}30`, "transparent"]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.48 }} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={[styles.topRim, { backgroundColor: colors.glassRim }]} />
      {children}
    </View>
  );
}

type GlassButtonProps = Omit<PressableProps, "children" | "style"> & { children: ReactNode; style?: StyleProp<ViewStyle> };

export function AccentButton({ children, style, disabled, ...props }: GlassButtonProps) {
  const colors = useTheme();
  return (
    <Pressable {...props} disabled={disabled} style={({ pressed }) => [styles.button, { shadowColor: colors.accentGlow }, style, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      <GlassSurface interactive style={StyleSheet.absoluteFill} />
      <LinearGradient colors={colors.accentGradient} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      <View style={styles.buttonContent}>{children}</View>
    </Pressable>
  );
}

export function NeutralButton({ children, style, disabled, ...props }: GlassButtonProps) {
  const colors = useTheme();
  return (
    <Pressable {...props} disabled={disabled} style={({ pressed }) => [styles.button, { backgroundColor: colors.textPrimary }, style, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      <View style={styles.buttonContent}>{children}</View>
    </Pressable>
  );
}

export function AccentChip({ children, style, ...props }: ViewProps) {
  const colors = useTheme();
  return <GlassSurface {...props} style={[styles.chip, { borderColor: colors.accent, shadowColor: colors.accentGlow }, style]}>{children}</GlassSurface>;
}

export function GlassSheet(props: ViewProps & { variant?: GlassVariant }) {
  return <GlassSurface {...props} variant={props.variant ?? "elevated"} />;
}

export function GlassTabBar(props: ViewProps) {
  return <GlassSurface {...props} variant="elevated" />;
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
  topRim: { position: "absolute", top: 0, left: 18, right: 18, height: StyleSheet.hairlineWidth },
  button: { minHeight: 50, borderRadius: 25, overflow: "hidden", shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.2, shadowRadius: 14, elevation: 7 },
  buttonContent: { flex: 1, minHeight: 48, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  chip: { minHeight: 34, borderRadius: 17, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", shadowOpacity: 0.2, shadowRadius: 10 },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.86, transform: [{ scale: 0.985 }] },
});
