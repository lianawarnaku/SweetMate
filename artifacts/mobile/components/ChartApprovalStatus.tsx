import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/constants/colors";
import type { ChartApproval } from "@/context/AppContext";
import { chartApprovalProgress } from "@/lib/chartApprovals";

export function ChartApprovalStatus({ chartId, members, approvals, currentUserId, revised = false }: {
  chartId: string | null;
  members: Array<{ id: string; name: string }>;
  approvals: ChartApproval[];
  currentUserId: string;
  revised?: boolean;
}) {
  const colors = useTheme();
  const progress = chartApprovalProgress(chartId, members, approvals);
  return <View style={[styles.section, { borderColor: colors.border }]}>
    <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>{revised ? "Current shared chart approvals" : "Approval status"}</Text>
    <Text accessibilityLiveRegion="polite" style={[styles.meta, { color: colors.mutedForeground }]}>{progress.approvedCount} of {progress.totalCount} approved</Text>
    {revised && <Text style={[styles.meta, { color: colors.mutedForeground }]}>Submitting your revision resets these approvals.</Text>}
    {progress.rows.map((member) => <View key={member.id} style={styles.row}>
      <Feather name={member.approved ? "check-circle" : "clock"} size={15} color={colors.mutedForeground} />
      <Text style={[styles.name, { color: colors.foreground }]}>{member.name}{member.id === currentUserId ? " (you)" : ""}</Text>
      <Text style={[styles.meta, { color: colors.mutedForeground }]}>{member.approved ? "Approved" : "Pending"}</Text>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  section: { marginTop: 16, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  name: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32 },
});
