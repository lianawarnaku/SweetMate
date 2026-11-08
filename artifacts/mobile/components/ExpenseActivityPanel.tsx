import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SectionDivider } from "@/components/SectionDivider";
import { useTheme } from "@/constants/colors";
export type ExpenseActivityItem = { id: string; expenseId: string; actorId: string | null; action: string; createdAt: string; amountCents?: number; summary: string };
export function ExpenseActivityPanel({ activity, actorName, expenseTitle, onOpenExpense, loading = false, error, onRetry }: {
  activity: readonly ExpenseActivityItem[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  actorName: (id: string | null) => string;
  expenseTitle: (id: string) => string;
  onOpenExpense?: (id: string) => void;
}) {
  const colors = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [limit, setLimit] = useState(10);
  const sorted = [...activity].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return <View>
    <SectionDivider title="Recent activity" icon="activity" count={activity.length} expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
    {expanded ? <View style={{ gap: 10 }}>
      <Text style={[styles.hint, { color: colors.mutedForeground }]}>Changes to shared expenses are visible to your household. Repayment records do not transfer money.</Text>
      {loading ? <Text style={[styles.hint, { color: colors.mutedForeground }]}>Refreshing activity…</Text> : null}
      {error ? <View style={{ gap: 6 }}><Text accessibilityRole="alert" style={[styles.hint, { color: colors.destructive }]}>{error}</Text><TouchableOpacity accessibilityRole="button" style={styles.more} disabled={loading} onPress={onRetry}><Text style={[styles.title, { color: colors.primary }]}>Retry activity</Text></TouchableOpacity></View> : null}
      {sorted.slice(0, limit).map((event) => <TouchableOpacity key={event.id} accessibilityRole={onOpenExpense ? "button" : undefined} disabled={!onOpenExpense} style={[styles.row, { borderColor: colors.border }]} onPress={() => onOpenExpense?.(event.expenseId)}>
        <Text style={[styles.title, { color: colors.foreground }]}>{expenseTitle(event.expenseId)}</Text>
        <Text style={[styles.hint, { color: colors.foreground }]}>{event.summary}{event.amountCents === undefined ? "" : ` · $${(event.amountCents / 100).toFixed(2)}`}</Text>
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>{actorName(event.actorId)} · {new Date(event.createdAt).toLocaleString()}</Text>
      </TouchableOpacity>)}
      {sorted.length === 0 && !loading && !error ? <Text style={[styles.hint, { color: colors.mutedForeground }]}>Recent changes appear here as they sync.</Text> : null}
      {sorted.length > limit ? <TouchableOpacity accessibilityRole="button" style={styles.more} onPress={() => setLimit((value) => value + 10)}><Text style={[styles.title, { color: colors.primary }]}>Show more activity</Text></TouchableOpacity> : null}
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({
  row: { minHeight: 44, borderWidth: 1, borderRadius: 13, padding: 12, gap: 4 },
  title: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 14 },
  hint: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 13, lineHeight: 18 },
  more: { minHeight: 44, alignItems: "center", justifyContent: "center" },
});
