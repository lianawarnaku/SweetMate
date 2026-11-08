import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SectionDivider } from "@/components/SectionDivider";
import { Surface } from "@/components/Surface";
import { useTheme } from "@/constants/colors";

export type ExpenseRequestItem = {
  operationId: string;
  expenseId: string;
  action: string;
  title: string;
  amountCents?: number;
  status: "pending" | "failed";
  error?: string;
  createdAt: string;
};
const actionLabels: Record<string, string> = {
  create: "New expense", update: "Expense edit", repay: "Repayment record", undo_repay: "Repayment correction",
  settle: "Entire IOU settlement", reopen: "Reopen IOU", delete: "Void expense", restore: "Restore expense",
};
export function ExpenseRequestPanel({ requests, busy, onRetry, onRecover, onDismiss, onOpenExpense }: {
  requests: readonly ExpenseRequestItem[];
  busy: boolean;
  onRetry: () => void;
  onRecover: (id: string) => void;
  onDismiss: (id: string) => void;
  onOpenExpense: (id: string) => void;
}) {
  const colors = useTheme();
  const [expanded, setExpanded] = useState(true);
  const [limit, setLimit] = useState(3);
  const [discarding, setDiscarding] = useState<string | null>(null);
  if (requests.length === 0) return null;
  return <View>
    <SectionDivider title="Saved requests" icon="clock" count={requests.length} expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
    {expanded ? <View style={{ gap: 10 }}>
      <Text style={[styles.hint, { color: colors.mutedForeground }]}>Waiting requests are still being checked. Retry saved requests to confirm their status before changing them. Failed requests can be reviewed or dismissed.</Text>
      {requests.slice(0, limit).map((request) => <Surface key={request.operationId} style={[styles.card, { borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>{request.title || "Expense"}</Text>
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>{actionLabels[request.action] ?? "Expense change"}{request.amountCents === undefined ? "" : ` · $${(request.amountCents / 100).toFixed(2)}`}</Text>
        <Text style={[styles.hint, { color: request.status === "failed" ? colors.destructive : colors.mutedForeground }]}>{request.status === "failed" ? "Not saved to your household" : "Waiting for confirmation"}</Text>
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>Saved on this device{Number.isFinite(Date.parse(request.createdAt)) ? ` · ${new Date(request.createdAt).toLocaleString()}` : ""}</Text>
        {request.error ? <Text accessibilityRole="alert" style={[styles.hint, { color: colors.destructive }]}>{request.error}</Text> : null}
        {request.status === "pending" ? <TouchableOpacity disabled={busy} accessibilityRole="button" style={[styles.button, { borderColor: colors.border }]} onPress={onRetry}>
          <Text style={[styles.buttonText, { color: colors.primary }]}>{busy ? "Checking…" : "Retry saved requests"}</Text>
        </TouchableOpacity> : <>
          <View style={styles.actions}>
            {request.action === "create" || request.action === "update" ? <TouchableOpacity disabled={busy} accessibilityRole="button" style={[styles.button, { borderColor: colors.border }]} onPress={() => onRecover(request.operationId)}>
              <Text style={[styles.buttonText, { color: colors.primary }]}>Review draft</Text>
            </TouchableOpacity> : <TouchableOpacity disabled={busy} accessibilityRole="button" style={[styles.button, { borderColor: colors.border }]} onPress={() => onOpenExpense(request.expenseId)}>
              <Text style={[styles.buttonText, { color: colors.primary }]}>View expense</Text>
            </TouchableOpacity>}
            <TouchableOpacity disabled={busy} accessibilityRole="button" style={[styles.button, { borderColor: colors.border }]} onPress={() => setDiscarding(request.operationId)}>
              <Text style={[styles.buttonText, { color: colors.mutedForeground }]}>Dismiss request</Text>
            </TouchableOpacity>
          </View>
          {discarding === request.operationId ? <View style={{ gap: 8 }}>
            <Text style={[styles.hint, { color: colors.foreground }]}>Dismiss this failed request? The household's recorded expense stays unchanged.</Text>
            <View style={styles.actions}>
              <TouchableOpacity disabled={busy} accessibilityRole="button" style={[styles.button, { borderColor: colors.border }]} onPress={() => setDiscarding(null)}><Text style={[styles.buttonText, { color: colors.foreground }]}>Keep request</Text></TouchableOpacity>
              <TouchableOpacity disabled={busy} accessibilityRole="button" style={[styles.button, { borderColor: colors.destructive }]} onPress={() => { onDismiss(request.operationId); setDiscarding(null); }}><Text style={[styles.buttonText, { color: colors.destructive }]}>Dismiss</Text></TouchableOpacity>
            </View>
          </View> : null}
        </>}
      </Surface>)}
      {requests.length > limit ? <TouchableOpacity accessibilityRole="button" style={[styles.button, { borderColor: colors.border }]} onPress={() => setLimit((value) => value + 3)}><Text style={[styles.buttonText, { color: colors.primary }]}>Show more requests</Text></TouchableOpacity> : null}
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({
  card: { padding: 14, borderWidth: 1, borderRadius: 15, gap: 7 },
  title: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 15 },
  hint: { fontFamily: "Inter_400Regular", includeFontPadding: false, fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: { minHeight: 44, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: 11 },
  buttonText: { fontFamily: "Inter_600SemiBold", includeFontPadding: false, fontSize: 13, textAlign: "center" },
});
