import type { ComponentProps } from "react";
import { StyleSheet } from "react-native";

import { GlassControlSurface } from "@/components/GlassControlSurface";

export function GlassActionBar({ style, ...props }: ComponentProps<typeof GlassControlSurface>) {
  return <GlassControlSurface {...props} style={[styles.bar, style]} />;
}

const styles = StyleSheet.create({
  bar: { borderRadius: 24, padding: 12, gap: 12 },
});
