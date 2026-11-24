import type { ComponentProps } from "react";
import { StyleSheet } from "react-native";

import { GlassSurface } from "@/components/LiquidGlass";

/** Shared material for floating controls; content cards keep their own fills. */
export function GlassControlSurface({ style, borderless = false, ...props }: ComponentProps<typeof GlassSurface> & { borderless?: boolean }) {
  return <GlassSurface {...props} variant="elevated" material="glass" style={[styles.surface, borderless && styles.borderless, style]} />;
}

const styles = StyleSheet.create({
  surface: { borderRadius: 26, shadowOpacity: 0, elevation: 0 },
  borderless: { borderWidth: 0 },
});
