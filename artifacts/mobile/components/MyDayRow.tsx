import React from "react";
import { StyleSheet, type ViewProps } from "react-native";
import { CompletionMotion } from "@/components/CompletionMotion";
import { Surface } from "@/components/Surface";
import { useTheme } from "@/constants/colors";
import { radii, spacing, typography } from "@/constants/designTokens";

/** Chores and imported items share the same dimensions, including large text. */
export function MyDayRow({ completed, departing = false, children, ...props }: ViewProps & {
  completed: boolean;
  departing?: boolean;
}) {
  const colors = useTheme();
  return <CompletionMotion completed={completed} departing={departing}>
    <Surface {...props} level="subtle" style={[myDayRowStyles.card, { borderColor: colors.border }, props.style]}>
      {children}
    </Surface>
  </CompletionMotion>;
}

export const myDayRowStyles = StyleSheet.create({
  card: { minHeight: 80, flexDirection: "row", alignItems: "center", paddingVertical: spacing.md,
    paddingLeft: spacing.sm, paddingRight: spacing.md, borderRadius: radii.card, borderWidth: 1, gap: spacing.sm },
  check: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  visual: { width: 42, height: 30, borderRadius: radii.small, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0 },
  title: { ...typography.label, includeFontPadding: false },
  meta: { minHeight: 24, flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs, overflow: "hidden" },
  metadataText: { ...typography.caption, includeFontPadding: false, flexShrink: 1 },
  trailing: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
});
