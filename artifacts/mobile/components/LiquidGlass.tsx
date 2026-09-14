import { BlurView } from "expo-blur";
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
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
  // Sheets need a stable frosted fill; native interactive glass adds a bright
  // specular highlight and does not honor our modal opacity.
  const isSheet = variant === "modal" || variant === "destructive";
  const nativeGlass = Platform.OS === "ios" && !isSheet && !interactive && !reduceTransparency && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
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
      borderColor: colors.divider,
      shadowColor: "#000000",
      shadowOpacity: shadow.shadowOpacity,
      shadowRadius: shadow.shadowRadius,
      elevation: shadow.elevation,
    },
    style,
  ];

  if (nativeGlass) {
    return (
      <GlassView {...props} colorScheme={colors.mode} glassEffectStyle="regular" isInteractive={interactive} tintColor={colors.mode === "dark" ? "#242428" : "#E8E8ED"} style={surfaceStyle}>
        {children}
      </GlassView>
    );
  }
  // Blur only the background layer so labels and icons remain sharp.
  // A dense modal tint prevents the underlying page showing through the text.
  const fill = reduceTransparency
    ? (colors.mode === "dark" ? "#202024" : "#F7F7FA")
    : baseColor;
  return (
    <View {...props} style={surfaceStyle}>
      {!reduceTransparency && Platform.OS !== "web" && (
        <BlurView pointerEvents="none" intensity={treatment.blurIntensity} tint={colors.mode} style={StyleSheet.absoluteFill} />
      )}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: fill },
          Platform.OS === "web" && !reduceTransparency && isSheet
            ? styles.webFrost
            : undefined,
        ]}
      />
      {children}
    </View>
  );
}

type GlassButtonProps = Omit<PressableProps, "children" | "style"> & { children: ReactNode; style?: StyleProp<ViewStyle> };

export function AccentButton({ children, style, disabled, ...props }: GlassButtonProps) {
  const colors = useTheme();
  return (
    <Pressable {...props} disabled={disabled} style={({ pressed }) => [styles.button, { backgroundColor: colors.action }, style, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      <View style={styles.buttonContent}>{children}</View>
    </Pressable>
  );
}

export function NeutralButton({ children, style, disabled, ...props }: GlassButtonProps) {
  const colors = useTheme();
  return (
    <Pressable {...props} disabled={disabled} style={({ pressed }) => [styles.button, { backgroundColor: colors.surfaceElevated }, style, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      <View style={styles.buttonContent}>{children}</View>
    </Pressable>
  );
}

export function AccentChip({ children, style, ...props }: ViewProps) {
  const colors = useTheme();
  return <GlassSurface {...props} style={[styles.chip, { borderColor: colors.divider }, style]}>{children}</GlassSurface>;
}

export function GlassSheet(props: ViewProps & { variant?: GlassVariant }) {
  return <GlassSurface {...props} variant={props.variant ?? "modal"} />;
}

export function GlassTabBar(props: ViewProps) {
  return <GlassSurface {...props} variant="elevated" />;
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, shadowOffset: { width: 0, height: 10 } },
  webFrost: { backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" } as ViewStyle,
  button: { minHeight: interaction.comfortableTouchTarget, borderRadius: radii.pill, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: "transparent" },
  buttonContent: { flex: 1, minHeight: interaction.comfortableTouchTarget, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  chip: { minHeight: 34, borderRadius: radii.pill, paddingHorizontal: spacing.md, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: interaction.disabledOpacity },
  pressed: { opacity: 0.86, transform: [{ scale: interaction.pressedScale }] },
});
