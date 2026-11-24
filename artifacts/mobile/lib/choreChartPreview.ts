import type { Chore, GeneratedTask } from "../context/AppContext";
import { materializeApprovedChart, difficultyForPoints, type ChartPayload } from "./choreChart.ts";
import { choreDefinitionId } from "./choreIdentity.ts";
import { choreChartWeekStart, projectChoreChartSchedule } from "./choreChartSchedule.ts";
import { advanceScheduledDate, resolveRoundRobinParticipants } from "./choreSchedule.ts";
import { householdDateKey } from "./choreTimezone.ts";

export interface PreviewTaskRow {
  id: string;
  title: string;
  difficulty: GeneratedTask["difficulty"];
  frequency?: Chore["recurring"];
  timeOfDay?: Chore["timeOfDay"];
  dates: string[];
  workload: number;
}

export interface PreviewWeek {
  startsOn: string;
  endsOn: string;
  members: Array<{ memberId: string; workload: number; tasks: PreviewTaskRow[] }>;
}

export function previewDateAfter(date: string, days: number): string {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

/** Build temporary schedule anchors only; browsing never writes household chores. */
export function proposedChartPreviewAnchors({ payload, members, chores, householdId, now, timezone }: {
  payload: ChartPayload;
  members: Array<{ id: string }>;
  chores: Chore[];
  householdId: string;
  now: Date;
  timezone: string;
}): Chore[] {
  return materializeApprovedChart({
    payload, members, chores, householdId, now, timezone,
    chartId: "read-only-preview", creatorId: members[0]?.id ?? "preview",
  });
}

/** Actual occurrences for a Monday–Sunday week, including within-week rotations. */
export function proposedChartPreviewWeek({ anchors, memberIds, weekOf, now, timezone }: {
  anchors: readonly Chore[];
  memberIds: string[];
  weekOf: string;
  now: Date;
  timezone: string;
}): PreviewWeek {
  const startsOn = choreChartWeekStart(weekOf);
  const endsOn = previewDateAfter(startsOn, 6);
  const taskBySeries = new Map(anchors.map((chore) => [
    JSON.stringify([chore.householdId, choreDefinitionId(chore)]), chore,
  ]));
  const rowsByMember = new Map(memberIds.map((id) => [id, new Map<string, PreviewTaskRow>()]));
  const occurrences = projectChoreChartSchedule(anchors, memberIds, startsOn, endsOn, householdDateKey(now, timezone));
  for (const occurrence of occurrences) {
    const anchor = taskBySeries.get(occurrence.seriesId);
    const rows = rowsByMember.get(occurrence.assignedTo);
    if (!anchor || !rows) continue;
    const difficulty = difficultyForPoints(anchor.points);
    const row = rows.get(occurrence.seriesId) ?? {
      id: occurrence.seriesId, title: anchor.title, difficulty,
      frequency: anchor.recurring, timeOfDay: anchor.timeOfDay, dates: [], workload: 0,
    };
    row.dates.push(occurrence.scheduledDate);
    row.workload += difficulty;
    rows.set(row.id, row);
  }
  return {
    startsOn, endsOn,
    members: memberIds.map((memberId) => {
      const tasks = [...rowsByMember.get(memberId)!.values()].sort((a, b) => a.title.localeCompare(b.title));
      return { memberId, workload: tasks.reduce((sum, task) => sum + task.workload, 0), tasks };
    }),
  };
}

/** Bound the preview by one turn per eligible person for every active chore. */
export function proposedChartRotationWindow({ anchors, memberIds, firstWeek, now, timezone }: {
  anchors: readonly Chore[];
  memberIds: string[];
  firstWeek: string;
  now: Date;
  timezone: string;
}): { weekCount: number; complete: boolean } {
  const startsOn = choreChartWeekStart(firstWeek);
  const expected = new Map<string, Set<string>>();
  let horizon = previewDateAfter(startsOn, 6);
  for (const anchor of anchors) {
    const participants = anchor.assignmentMode === "round-robin"
      ? resolveRoundRobinParticipants(anchor, memberIds)
      : memberIds.includes(anchor.assignedTo) ? [anchor.assignedTo] : [];
    if (!participants.length) continue;
    let date = anchor.initialScheduledDate ?? anchor.scheduledDate ?? householdDateKey(new Date(anchor.dueDate), timezone);
    let steps = 0;
    while (date < startsOn && anchor.recurring && steps++ < 10000) {
      date = advanceScheduledDate(date, anchor.recurring, anchor.monthlyAnchorDay);
    }
    if (date < startsOn || (anchor.recurrenceEndsOn && date >= anchor.recurrenceEndsOn)) continue;
    const series = JSON.stringify([anchor.householdId, choreDefinitionId(anchor)]);
    expected.set(series, new Set(participants));
    // Finite excluded dates can skip a member's turn; include enough further
    // rotations for that member to get their next eligible occurrence.
    const turns = participants.length * ((anchor.excludedOccurrenceDates?.length ?? 0) + 1);
    for (let index = 1; anchor.recurring && index < turns; index++) {
      date = advanceScheduledDate(date, anchor.recurring, anchor.monthlyAnchorDay);
    }
    if (date > horizon) horizon = date;
  }
  if (!expected.size) return { weekCount: 1, complete: true };
  const occurrences = projectChoreChartSchedule(anchors, memberIds, startsOn, horizon, householdDateKey(now, timezone));
  const remaining = new Map([...expected].map(([id, participants]) => [id, new Set(participants)]));
  for (const occurrence of occurrences) {
    const participants = remaining.get(occurrence.seriesId);
    participants?.delete(occurrence.assignedTo);
    if (participants?.size === 0) remaining.delete(occurrence.seriesId);
    if (!remaining.size) {
      const days = (new Date(`${occurrence.scheduledDate}T12:00:00Z`).getTime() - new Date(`${startsOn}T12:00:00Z`).getTime()) / 86400000;
      return { weekCount: Math.floor(days / 7) + 1, complete: true };
    }
  }
  const days = (new Date(`${horizon}T12:00:00Z`).getTime() - new Date(`${startsOn}T12:00:00Z`).getTime()) / 86400000;
  return { weekCount: Math.floor(days / 7) + 1, complete: false };
}

export function nextChartPreviewWeek(current: number, weekCount: number): number {
  return current >= Math.max(1, weekCount) ? 0 : current + 1;
}
