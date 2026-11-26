import type { ReactNode } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";

import { SectionDivider } from "@/components/SectionDivider";
import { Surface } from "@/components/Surface";
import { useTheme } from "@/constants/colors";
import { radii, spacing } from "@/constants/designTokens";

/** A new native section replaces the inline calendar when the summary is dismissed. */
export function HomeCalendarSection({ dismissed, expanded, count, onToggle, onLayout, children }: {
  dismissed: boolean;
  expanded: boolean;
  count: number;
  onToggle: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
  children: ReactNode;
}) {
  return <View key={dismissed ? "attached-calendar-slot" : "inline-calendar-section"} collapsable={false}>
    {!dismissed && <SectionDivider title="Calendar" count={count} icon="calendar" expanded={expanded} onToggle={onToggle} />}
    {(dismissed || expanded) && <View onLayout={onLayout}>{children}</View>}
  </View>;
}

/** The attached week is a full-width header, with no card surface to retain on iOS. */
export function HomeCalendarBody({ attached, children }: { attached: boolean; children: ReactNode }) {
  const colors = useTheme();
  return attached
    ? <View testID="home-attached-calendar-body" collapsable={false} style={[styles.attached, { backgroundColor: colors.background }]}>{children}</View>
    : <Surface testID="home-calendar-card" style={[styles.card, { borderColor: colors.border }]}>{children}</Surface>;
}

const styles = StyleSheet.create({
  attached: { padding: spacing.md, paddingHorizontal: 16 },
  card: { borderRadius: radii.card, borderWidth: 1, padding: spacing.md, marginBottom: spacing.lg },
});
