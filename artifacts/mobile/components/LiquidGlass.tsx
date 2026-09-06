import { BlurView } from "expo-blur";
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import React, { type ReactNode, useEffect, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewProps, type ViewStyle } from "react-native";

import { useTheme } from "@/constants/colors";
import { elevation, glass, interaction, radii, spacing, type GlassLevel } from "@/constants/designTokens";

export type GlassVariant = "subtle" | "regular" | "elevated" | "modal" | "destructive";

const variantLevel: Record<Exclude<GlassVariant, "destructive">, GlassLevel> = {
  subtle: "subtle",
  regular: "card",
  elevated: "elevated",
  modal: "modal",
};

function useReduceTransparency() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (Platform.OS === "web" || typeof AccessibilityInfo.isReduceTransparencyEnabled !== "function") {
      setReduced(false);
      return;
    }
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
  const level = variant === "destructive" ? "modal" : variantLevel[variant];
  const treatment = glass[level];
  const baseColor = variant === "destructive"
    ? colors.destructiveSurface
    : variant === "subtle"
      ? colors.surfaceSubtle
      : variant === "elevated"
        ? colors.surfaceElevated
        : variant === "modal"
          ? colors.surfaceModal
          : colors.surface;
  const shadow = level === "modal" ? elevation.modal : level === "elevated" ? elevation.floating : elevation.flat;
  const surfaceStyle = [
    styles.clip,
    {
      borderColor: colors.glassRim,
      shadowColor: colors.mode === "dark" ? "#000000" : colors.accentGlow,
      shadowOpacity: shadow.shadowOpacity,
      shadowRadius: shadow.shadowRadius,
      elevation: shadow.elevation,
    },
    style,
  ];

  if (nativeGlass) {
    return (
      <GlassView {...props} colorScheme={colors.mode} glassEffectStyle="regular" isInteractive={interactive} tintColor={variant === "destructive" ? colors.destructive : colors.accent} style={surfaceStyle}>
        {children}
      </GlassView>
    );
  }
  // Web blur can rasterize a surface together with its children, making text
  // and icons appear soft. Keep the translucent glass color but render it
  // without BlurView in browser previews.
  if (reduceTransparency || Platform.OS === "web") {
    return (
      <View {...props} style={[surfaceStyle, { backgroundColor: baseColor, borderColor: colors.divider }]}>
        <View pointerEvents="none" style={[styles.topRim, { backgroundColor: colors.glassHighlight }]} />
        {children}
      </View>
    );
  }
  return (
    <View {...props} style={surfaceStyle}>
      <BlurView intensity={treatment.blurIntensity} tint={colors.mode} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: baseColor }]} />
      <LinearGradient pointerEvents="none" colors={[`${variant === "destructive" ? colors.destructive : colors.accent}30`, "transparent"]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.48 }} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={[styles.topRim, { backgroundColor: colors.glassHighlight }]} />
      {children}
    </View>
  );
}

type GlassButtonProps = Omit<PressableProps, "children" | "style"> & { children: ReactNode; style?: StyleProp<ViewStyle> };

export function AccentButton({ children, style, disabled, ...props }: GlassButtonProps) {
  const colors = useTheme();
  return (
    <Pressable {...props} disabled={disabled} style={({ pressed }) => [styles.button, { shadowColor: colors.accentGlow, shadowOpacity: colors.accentGlowOpacity }, style, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
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
  return <GlassSurface {...props} variant={props.variant ?? "modal"} />;
}

export function GlassTabBar(props: ViewProps) {
  return <GlassSurface {...props} variant="elevated" />;
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, shadowOffset: { width: 0, height: 10 } },
  topRim: { position: "absolute", top: 0, left: spacing.lg, right: spacing.lg, height: StyleSheet.hairlineWidth },
  button: { minHeight: interaction.comfortableTouchTarget, borderRadius: radii.pill, overflow: "hidden", shadowOffset: { width: 0, height: 5 }, shadowRadius: 14, elevation: 7 },
  buttonContent: { flex: 1, minHeight: interaction.comfortableTouchTarget, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  chip: { minHeight: 34, borderRadius: radii.pill, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center", shadowOpacity: 0.16, shadowRadius: 10 },
  disabled: { opacity: interaction.disabledOpacity },
  pressed: { opacity: 0.86, transform: [{ scale: interaction.pressedScale }] },
});
