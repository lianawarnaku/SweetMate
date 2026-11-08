import type { Chore, ChoreRecurrence } from "../context/AppContext";
import { householdDateKey, householdDueDate } from "./choreTimezone.ts";

export const CHORE_RECURRENCE_LABELS: Record<ChoreRecurrence, string> = {
  daily: "Daily",
  everyOtherDay: "Every other day",
  everyThreeDays: "Every 3 days",
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
};

function stepDaysFor(recurrence: ChoreRecurrence): number {
  return recurrence === "daily" ? 1
    : recurrence === "everyOtherDay" ? 2
    : recurrence === "everyThreeDays" ? 3
    : recurrence === "biweekly" ? 14
    : 7;
}

/**
 * Days until a freshly generated chore's first occurrence is due. Kept as
 * the single source of truth for this so a generator (e.g. the planner)
 * cannot independently reinvent the daily/everyOtherDay/everyThreeDays/weekly/biweekly
 * mapping and drift from what advanceScheduledDate actually steps by.
 */
export function initialIntervalDaysFor(recurrence: ChoreRecurrence): number {
  return recurrence === "monthly" ? 30 : stepDaysFor(recurrence);
}

export function advanceChoreDueDate(
  dateValue: string,
  recurrence: ChoreRecurrence,
  monthlyAnchorDay?: number,
  timezone?: string,
): string {
  const next = new Date(dateValue);
  if (timezone) {
    const date = householdDateKey(next, timezone);
    const nextDate = advanceScheduledDate(date, recurrence, monthlyAnchorDay ?? Number(date.slice(-2)));
    return dueDateForScheduledDate(nextDate, dateValue, timezone);
  }
  if (recurrence === "monthly") {
    const originalDay = monthlyAnchorDay ?? next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    const finalDay = new Date(
      next.getFullYear(),
      next.getMonth() + 1,
      0,
    ).getDate();
    next.setDate(Math.min(originalDay, finalDay));
  } else {
    next.setDate(next.getDate() + stepDaysFor(recurrence));
  }
  return next.toISOString();
}

export function advanceScheduledDate(
  scheduledDate: string,
  recurrence: ChoreRecurrence,
  monthlyAnchorDay?: number,
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(scheduledDate);
  if (!match) return "";
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, monthIndex, day, 12));
  if (recurrence === "monthly") {
    const targetMonth = monthIndex + 1;
    const targetYear = year + Math.floor(targetMonth / 12);
    const normalizedMonth = ((targetMonth % 12) + 12) % 12;
    const finalDay = new Date(
      Date.UTC(targetYear, normalizedMonth + 1, 0, 12),
    ).getUTCDate();
    const targetDay = Math.min(monthlyAnchorDay ?? day, finalDay);
    return [
      targetYear,
      String(normalizedMonth + 1).padStart(2, "0"),
      String(targetDay).padStart(2, "0"),
    ].join("-");
  }
  date.setUTCDate(date.getUTCDate() + stepDaysFor(recurrence));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function resolveRoundRobinParticipants(
  chore: Chore,
  activeMemberIds: string[],
): string[] {
  const active = new Set(activeMemberIds);
  const excluded = new Set(chore.excludedParticipantIds ?? []);
  const stored = [...new Set((chore.roundRobinParticipantIds ?? []).filter(
    (id) => active.has(id) && !excluded.has(id),
  ))];
  if (!chore.roundRobinAllMembers) return stored;
  const addedMembers = [...active]
    .filter((id) => !stored.includes(id) && !excluded.has(id))
    .sort();
  return [...stored, ...addedMembers];
}

/** Move a due instant onto a calendar date, preserving its household wall time. */
export function dueDateForScheduledDate(
  scheduledDate: string,
  anchorTimestamp: string,
  timezone?: string,
): string {
  const anchor = new Date(anchorTimestamp);
  if (timezone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(anchor);
    const part = (key: string) => Number(parts.find((entry) => entry.type === key)?.value ?? 0);
    return householdDueDate(scheduledDate, part("hour"), timezone, part("minute"), part("second"), anchor.getUTCMilliseconds());
  }
  const [year, month, day] = scheduledDate.split("-").map(Number);
  return new Date(year, month - 1, day, anchor.getHours(), anchor.getMinutes(), anchor.getSeconds(), anchor.getMilliseconds()).toISOString();
}

/** Advance scheduled turns from the recorded assignee using today's eligible roster. */
export function roundRobinAssigneeAfter(
  chore: Chore,
  activeMemberIds: string[],
  steps = 1,
): string | undefined {
  const participants = resolveRoundRobinParticipants(chore, activeMemberIds);
  if (chore.assignmentMode !== "round-robin") {
    return activeMemberIds.includes(chore.assignedTo) && !(chore.excludedParticipantIds ?? []).includes(chore.assignedTo)
      ? chore.assignedTo : undefined;
  }
  if (!participants.length) return undefined;
  const turns = Number.isFinite(steps) ? Math.max(0, Math.floor(steps)) : 1;
  const currentIndex = participants.indexOf(chore.assignedTo);
  if (currentIndex >= 0) return participants[(currentIndex + turns) % participants.length];
  // A departing/excluded assignee's next surviving old successor gets the first turn.
  const oldRoster = chore.roundRobinParticipantIds ?? [];
  const oldIndex = oldRoster.indexOf(chore.assignedTo);
  if (oldIndex >= 0) {
    for (let step = 1; step <= oldRoster.length; step += 1) {
      const candidate = oldRoster[(oldIndex + step) % oldRoster.length];
      const nextIndex = participants.indexOf(candidate);
      if (nextIndex >= 0) return participants[(nextIndex + Math.max(0, turns - 1)) % participants.length];
    }
  }
  return participants[Math.max(0, turns - 1) % participants.length];
}
