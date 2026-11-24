import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { GlassButton } from "@/components/GlassButton";
import { useTheme } from "@/constants/colors";
import type { Chore, Roommate } from "@/context/AppContext";
import { averageWeeklyWorkloads, frequencyLabel, type ChartPayload } from "@/lib/choreChart";
import { choreChartWeekStart } from "@/lib/choreChartSchedule";
import { householdDateKey } from "@/lib/choreTimezone";
import { nextChartPreviewWeek, previewDateAfter, proposedChartPreviewAnchors, proposedChartPreviewWeek, proposedChartRotationWindow } from "@/lib/choreChartPreview";

const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });

function TaskDetail({ label }: { label: string }) {
  const colors = useTheme();
  return <View style={[styles.detailBadge, { backgroundColor: colors.muted }]}>
    <Text style={[styles.detailText, { color: colors.mutedForeground }]}>{label}</Text>
  </View>;
}

function timeOfDayLabel(value: string | undefined) {
  return value === "morning" ? "Morning" : value === "night" ? "Night" : "Any time";
}

export function ChoreChartPreview({ payload, members, chores, now, householdId, timezone, embedded = false }: {
  payload: ChartPayload;
  members: Roommate[];
  chores: Chore[];
  now: Date;
  householdId: string;
  timezone: string;
  embedded?: boolean;
}) {
  const colors = useTheme();
  const [weekOffset, setWeekOffset] = useState(0);
  const projection = useMemo(() => {
    try {
      const anchors = proposedChartPreviewAnchors({ payload, members, chores, now, householdId, timezone });
      const firstWeek = previewDateAfter(choreChartWeekStart(householdDateKey(now, timezone)), 7);
      const window = proposedChartRotationWindow({ anchors, memberIds: members.map((member) => member.id), firstWeek, now, timezone });
      return { anchors, firstWeek, ...window };
    } catch {
      return null;
    }
  }, [payload, members, chores, now, householdId, timezone]);
  const weeklyAverages = useMemo(() => averageWeeklyWorkloads({ payload, members, chores, now, householdId, timezone }), [payload, members, chores, now, householdId, timezone]);
  const week = useMemo(() => projection && weekOffset > 0 ? proposedChartPreviewWeek({
    anchors: projection.anchors, memberIds: members.map((member) => member.id),
    weekOf: previewDateAfter(projection.firstWeek, (weekOffset - 1) * 7), now, timezone,
  }) : null, [projection, weekOffset, members, now, timezone]);
  const atEnd = Boolean(projection && weekOffset === projection.weekCount);
  const nextWeek = () => { if (projection) setWeekOffset((current) => nextChartPreviewWeek(current, projection.weekCount)); };

  return <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, embedded && styles.embedded]}>
    <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[styles.title, { color: colors.foreground }]}>
      {week ? `Week ${weekOffset} of ${projection?.weekCount}` : "Proposed starting assignments"}
    </Text>
    {week && <Text style={[styles.meta, { color: colors.mutedForeground, marginTop: 6 }]}>{dateLabel(week.startsOn, { month: "short", day: "numeric", year: "numeric" })} – {dateLabel(week.endsOn, { month: "short", day: "numeric", year: "numeric" })}</Text>}
    <View style={styles.controls}>
      {weekOffset > 0 && <GlassButton tone="neutral" onPress={() => setWeekOffset((current) => Math.max(0, current - 1))} accessibilityLabel={weekOffset === 1 ? "Back to starting assignments" : "See previous week"} style={styles.navigation}>
        <Feather name="chevron-left" size={16} color={colors.foreground} />
        <Text style={[styles.buttonText, { color: colors.foreground }]}>{weekOffset === 1 ? "Starting view" : "Previous week"}</Text>
      </GlassButton>}
      <GlassButton tone="neutral" disabled={!projection} onPress={nextWeek} accessibilityLabel={atEnd ? "Back to starting assignments" : "See next week"} style={styles.navigation}>
        <Text style={[styles.buttonText, { color: colors.foreground }]}>{atEnd ? "Back to start" : "See next week"}</Text>
        <Feather name={atEnd ? "rotate-ccw" : "chevron-right"} size={16} color={colors.foreground} />
      </GlassButton>
    </View>
    {week ? week.members.map((member) => <View key={member.memberId} style={styles.memberSection}>
      <View style={styles.memberHeader}>
        <Text accessibilityRole="header" style={[styles.memberTitle, { color: colors.foreground }]}>{members.find((value) => value.id === member.memberId)?.name ?? "Sweetmate"}</Text>
        <View style={styles.workloadSummary}>
          <Text style={[styles.workloadValue, { color: colors.foreground }]}>{member.workload.toFixed(1)}</Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>Generated workload this week</Text>
          {weeklyAverages && <Text style={[styles.meta, { color: colors.mutedForeground }]}>Weekly average: {(weeklyAverages[member.memberId] ?? 0).toFixed(1)}</Text>}
        </View>
      </View>
      {!member.tasks.length && <Text style={[styles.meta, { color: colors.mutedForeground, marginTop: 8 }]}>No generated chores scheduled this week</Text>}
      {member.tasks.map((task) => <View key={task.id} style={[styles.taskRow, { borderTopColor: colors.border }]}>
        <Text style={[styles.taskTitle, { color: colors.foreground }]}>{task.title}</Text>
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>{task.dates.map((date) => dateLabel(date, { weekday: "short", day: "numeric" })).join(", ")}</Text>
        <View style={styles.taskDetails}>
          <TaskDetail label={`${task.dates.length} ${task.dates.length === 1 ? "turn" : "turns"}`} />
          <TaskDetail label={`Difficulty ${task.difficulty}/5`} />
          <TaskDetail label={`Workload ${task.workload.toFixed(1)}`} />
          <TaskDetail label={timeOfDayLabel(task.timeOfDay)} />
        </View>
      </View>)}
    </View>) : payload.assignments.map((assignment) => <View key={assignment.memberId} style={styles.memberSection}>
      <View style={styles.memberHeader}>
        <Text accessibilityRole="header" style={[styles.memberTitle, { color: colors.foreground }]}>{members.find((value) => value.id === assignment.memberId)?.name ?? "Sweetmate"}</Text>
        <View style={styles.workloadSummary}>
          {weeklyAverages && <Text style={[styles.workloadValue, { color: colors.foreground }]}>{(weeklyAverages[assignment.memberId] ?? 0).toFixed(1)}</Text>}
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>{weeklyAverages ? "Average weekly workload" : "Rebuild to calculate weekly workload"}</Text>
        </View>
      </View>
      {!assignment.taskIds.length && <Text style={[styles.meta, { color: colors.mutedForeground, marginTop: 8 }]}>No new starting assignments</Text>}
      {assignment.taskIds.map((taskId) => {
        const task = payload.generatedTasks?.find((entry) => entry.id === taskId);
        return task ? <View key={task.id} style={[styles.taskRow, { borderTopColor: colors.border }]}>
          <Text style={[styles.taskTitle, { color: colors.foreground }]}>{task.title}</Text>
          <View style={styles.taskDetails}>
            <TaskDetail label={frequencyLabel(task.frequency)} />
            <TaskDetail label={timeOfDayLabel(task.timeOfDay)} />
            <TaskDetail label={`Difficulty ${task.difficulty}/5`} />
            <TaskDetail label={payload.manualAssignmentTaskIds?.includes(task.id) ? "Manual schedule" : payload.pinnedAssignments?.[task.id] ? "Fixed assignee" : "Rotates"} />
          </View>
        </View> : null;
      })}
    </View>)}
    {atEnd && projection?.complete && <Text style={[styles.meta, { color: colors.mutedForeground, marginTop: 14 }]}>Full rotation previewed. Back to start returns to the original proposal.</Text>}
    {atEnd && projection && !projection.complete && <Text style={[styles.meta, { color: colors.mutedForeground, marginTop: 14 }]}>Some saved schedules end or have unfinished turns; their full rotation is not projected.</Text>}
    {!projection && <Text style={[styles.meta, { color: colors.mutedForeground, marginTop: 14 }]}>Rebuild the chart to preview its upcoming weeks.</Text>}
  </View>;
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 12, borderWidth: 1, borderRadius: 18, padding: 14 },
  embedded: { marginHorizontal: 0, marginTop: 0, borderWidth: 0, padding: 0, backgroundColor: "transparent" },
  title: { fontFamily: "Inter_700Bold", fontSize: 20 },
  memberSection: { marginTop: 24 },
  memberHeader: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 4 },
  memberTitle: { flexGrow: 1, flexShrink: 1, flexBasis: 120, fontFamily: "Inter_600SemiBold", fontSize: 18 },
  workloadSummary: { maxWidth: "100%", alignItems: "flex-end", gap: 2 },
  workloadValue: { fontFamily: "Inter_600SemiBold", fontSize: 22 },
  taskTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  taskRow: { minHeight: 64, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 12, gap: 8, marginTop: 8 },
  taskDetails: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  detailBadge: { maxWidth: "100%", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  detailText: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  controls: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  navigation: { borderRadius: 12, maxWidth: "100%" },
  buttonText: { fontFamily: "Inter_600SemiBold", fontSize: 12, flexShrink: 1 },
});
