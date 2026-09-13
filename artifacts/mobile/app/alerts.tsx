import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/constants/colors";
import { useAppContext } from "@/context/AppContext";
import { buildBalancedChart } from "@/lib/choreEngine";
import { error as hapticError, success as hapticSuccess } from "@/lib/haptics";
import { useConfirm } from "@/hooks/useConfirm";

function relativeTime(timestamp: string): string {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000));
  if (elapsedSeconds < 60) return "just now";
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

export default function AlertsScreen() {
  const { info } = useConfirm();
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const {
    currentProposedChart, chartApprovals, currentUserId, roommates,
    memberPreferences, approveProposedChart, forceApproveProposedChart,
    proposeChart, isHost, acknowledgeNudge,
    appAlerts, markAlertRead, markAllAlertsRead,
  } = useAppContext();
  const [busy, setBusy] = useState(false);
  const [overdueExpanded, setOverdueExpanded] = useState(false);
  const proposal = currentProposedChart?.status === "pending" ? currentProposedChart : null;
  const visibleAlerts = appAlerts.filter(
    (alert) => !alert.recipientId || alert.recipientId === currentUserId,
  );
  const overdueAlerts = visibleAlerts.filter((alert) => alert.type === "overdue-chore");
  const groupOverdueAlerts = overdueAlerts.length >= 3;
  const informationalAlerts = groupOverdueAlerts
    ? visibleAlerts.filter((alert) => alert.type !== "overdue-chore")
    : visibleAlerts;
  const feedItems = [
    ...(proposal ? [{ type: "proposal" as const, id: proposal.id }] : []),
    ...(groupOverdueAlerts ? [{ type: "overdue-summary" as const, id: "overdue-summary", alerts: overdueAlerts }] : []),
    ...informationalAlerts.map((alert) => ({ type: "informational" as const, id: alert.id, alert })),
    ...(groupOverdueAlerts && overdueExpanded
      ? overdueAlerts.map((alert) => ({ type: "informational" as const, id: alert.id, alert }))
      : []),
  ];
  const unreadCount = visibleAlerts.filter((alert) => !alert.readAt).length;
  const myApproval = chartApprovals.find((approval) => approval.memberId === currentUserId);
  const tasks = proposal?.payload.generatedTasks ?? [];

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      hapticSuccess();
    } catch {
      hapticError();
      info("chart_update_error", "Unable to update chart", "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const requestAssignment = (taskId: string, kind: "always" | "never") => {
    if (!proposal) return;
    act(async () => {
      const payload = buildBalancedChart(tasks, roommates, memberPreferences, {
        mode: "preference",
        pinnedAssignments: kind === "always" ? { [taskId]: currentUserId } : undefined,
        excludedAssignments: kind === "never" ? { [taskId]: [currentUserId] } : undefined,
      });
      await proposeChart(payload);
    });
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back from alerts"
          onPress={() => router.back()}
          style={[styles.icon, { backgroundColor: colors.muted }]}
        >
          <Feather name="chevron-left" size={21} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Alerts</Text>
        {unreadCount ? (
          <TouchableOpacity accessibilityRole="button" onPress={markAllAlertsRead} style={styles.markAll}>
            <Text style={[styles.markAllText, { color: colors.primary }]}>Read all</Text>
          </TouchableOpacity>
        ) : <View style={styles.icon} />}
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 30 }]}>
        {feedItems.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="check-circle" size={28} color={colors.success} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>You’re all caught up</Text>
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>Important Sweet updates will appear here.</Text>
          </View>
        ) : (
          feedItems.map((feedItem) => {
            if (feedItem.type === "overdue-summary") {
              const unreadOverdue = feedItem.alerts.filter((alert) => !alert.readAt).length;
              return (
                <TouchableOpacity
                  key={feedItem.id}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: overdueExpanded }}
                  accessibilityLabel={`${feedItem.alerts.length} overdue chores${unreadOverdue ? `, ${unreadOverdue} unread` : ""}`}
                  accessibilityHint={overdueExpanded ? "Collapses overdue chore alerts" : "Shows each overdue chore alert"}
                  onPress={() => setOverdueExpanded((value) => !value)}
                  activeOpacity={0.78}
                  style={[styles.nudgeCard, { backgroundColor: colors.card, borderColor: unreadOverdue ? colors.primary : colors.border }]}
                >
                  <View style={[styles.nudgeIcon, { backgroundColor: colors.primary + "14" }]}>
                    <Feather name="clock" size={19} color={colors.primary} />
                  </View>
                  <View style={styles.nudgeCopy}>
                    <View style={styles.alertTitleRow}>
                      {unreadOverdue ? <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} /> : null}
                      <Text style={[styles.nudgeTitle, { color: colors.foreground }]}>
                        {feedItem.alerts.length} chores need attention
                      </Text>
                    </View>
                    <Text style={[styles.alertMessage, { color: colors.mutedForeground }]}>Review your household schedule when you’re ready.</Text>
                  </View>
                  <Feather name={overdueExpanded ? "chevron-up" : "chevron-down"} size={19} color={colors.mutedForeground} />
                </TouchableOpacity>
              );
            }
            if (feedItem.type === "informational") {
              const icon =
                feedItem.alert.type === "difficulty-imbalance" ? "bar-chart-2" :
                feedItem.alert.type === "overdue-chore" ? "clock" :
                feedItem.alert.type === "expense" ? "dollar-sign" :
                feedItem.alert.type === "borrowing" ? "repeat" :
                feedItem.alert.type === "nudge" ? "bell" :
                feedItem.alert.type === "membership" ? "user-plus" : "info";
              return (
                <TouchableOpacity
                  key={`information:${feedItem.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${feedItem.alert.readAt ? "" : "Unread "}${feedItem.alert.title}`}
                  onPress={() => {
                    markAlertRead(feedItem.id);
                    if (feedItem.alert.type === "nudge") {
                      const nudgeId = feedItem.alert.id.replace(/^nudge:/, "");
                      void acknowledgeNudge(nudgeId).catch(() => {
                        hapticError();
                      });
                    }
                  }}
                  activeOpacity={0.78}
                  style={[styles.nudgeCard, { backgroundColor: colors.card, borderColor: feedItem.alert.readAt ? colors.border : colors.primary }]}
                >
                  <View style={[styles.nudgeIcon, { backgroundColor: colors.primary + "14" }]}>
                    <Feather name={icon} size={19} color={colors.primary} />
                  </View>
                  <View style={styles.nudgeCopy}>
                    <View style={styles.alertTitleRow}>
                      {!feedItem.alert.readAt ? <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} /> : null}
                      <Text style={[styles.nudgeTitle, { color: colors.foreground }]}>{feedItem.alert.title}</Text>
                    </View>
                    <Text style={[styles.alertMessage, { color: colors.mutedForeground }]}>{feedItem.alert.message}</Text>
                    <Text style={[styles.meta, { color: colors.mutedForeground }]}>{relativeTime(feedItem.alert.createdAt)}</Text>
                  </View>
                </TouchableOpacity>
              );
            }
            if (!proposal) return null;
            return (
              <View key={`proposal:${feedItem.id}`} style={styles.proposalGroup}>
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>Proposed chore chart</Text>
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                    Review the assignments below. Chores stay hidden until everyone approves.
                  </Text>
                  {proposal.payload.assignments.map((assignment) => {
                    const member = roommates.find((value) => value.id === assignment.memberId);
                    return (
                      <View key={assignment.memberId} style={[styles.assignment, { borderTopColor: colors.border }]}>
                        <Text style={[styles.member, { color: colors.foreground }]}>{member?.name ?? "Member"} · {assignment.totalLoad.toFixed(1)} load</Text>
                        {assignment.taskIds.map((taskId) => {
                          const task = tasks.find((value) => value.id === taskId);
                          if (!task) return null;
                          return (
                            <View key={taskId} style={styles.taskRow}>
                              <View style={{ flex: 1 }}>
                                <Text style={[styles.task, { color: colors.foreground }]}>{task.title}</Text>
                                <Text style={[styles.meta, { color: colors.mutedForeground }]}>{task.difficulty}/5 · {task.timeOfDay}</Text>
                              </View>
                              <TouchableOpacity disabled={busy} onPress={() => requestAssignment(taskId, "always")}><Text style={[styles.request, { color: colors.primary }]}>Always me</Text></TouchableOpacity>
                              <TouchableOpacity disabled={busy} onPress={() => requestAssignment(taskId, "never")}><Text style={[styles.request, { color: colors.destructive }]}>Never me</Text></TouchableOpacity>
                            </View>
                          );
                        })}
                      </View>
                    );
                  })}
                </View>
                <TouchableOpacity disabled={busy || myApproval?.approved} onPress={() => act(approveProposedChart)} style={[styles.primary, { backgroundColor: colors.action, opacity: busy || myApproval?.approved ? 0.55 : 1 }]}>
                  <Text style={[styles.primaryText, { color: colors.actionForeground }]}>{myApproval?.approved ? "Approved" : "Approve chart"}</Text>
                </TouchableOpacity>
                {isHost && (
                  <TouchableOpacity disabled={busy} onPress={() => act(forceApproveProposedChart)} style={[styles.override, { borderColor: colors.primary }]}>
                    <Text style={[styles.overrideText, { color: colors.primary }]}>Create chart anyway</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { minHeight: 78, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: "Inter_700Bold", fontSize: 27 },
  markAll: { minWidth: 56, minHeight: 40, alignItems: "center", justifyContent: "center" },
  markAllText: { fontFamily: "Inter_700Bold", fontSize: 13 },
  content: { padding: 16, gap: 12 },
  proposalGroup: { gap: 12 },
  card: { borderWidth: 1, borderRadius: 18, padding: 15 },
  cardTitle: { fontFamily: "Inter_700Bold", fontSize: 20 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 },
  assignment: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, marginTop: 12 },
  member: { fontFamily: "Inter_700Bold", fontSize: 16 },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 9 },
  task: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  request: { fontFamily: "Inter_700Bold", fontSize: 11 },
  primary: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  primaryText: { fontFamily: "Inter_700Bold", fontSize: 16 },
  override: { height: 50, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  overrideText: { fontFamily: "Inter_700Bold", fontSize: 15 },
  empty: { borderWidth: 1, borderRadius: 18, padding: 28, alignItems: "center" },
  emptyTitle: { fontFamily: "Inter_700Bold", fontSize: 19, marginTop: 8 },
  nudgeCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  nudgeIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  nudgeCopy: { flex: 1 },
  alertTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  unreadDot: { width: 7, height: 7, borderRadius: 4 },
  alertMessage: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18, marginTop: 3 },
  nudgeTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14, lineHeight: 20 },
  dismiss: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
