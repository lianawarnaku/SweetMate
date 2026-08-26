import type { Chore, ChoreRecurrence } from "../context/AppContext";

export const CHORE_RECURRENCE_LABELS: Record<ChoreRecurrence, string> = {
  daily: "Daily",
  everyOtherDay: "Every other day",
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
};

function stepDaysFor(recurrence: ChoreRecurrence): number {
  return recurrence === "daily" ? 1
    : recurrence === "everyOtherDay" ? 2
    : recurrence === "biweekly" ? 14
    : 7;
}

/**
 * Days until a freshly generated chore's first occurrence is due. Kept as
 * the single source of truth for this so a generator (e.g. the planner)
 * cannot independently reinvent the daily/everyOtherDay/weekly/biweekly
 * mapping and drift from what advanceScheduledDate actually steps by.
 */
export function initialIntervalDaysFor(recurrence: ChoreRecurrence): number {
  return recurrence === "monthly" ? 30 : stepDaysFor(recurrence);
}

export function advanceChoreDueDate(
  dateValue: string,
  recurrence: ChoreRecurrence,
  monthlyAnchorDay?: number,
): string {
  const next = new Date(dateValue);
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
  const stored = (chore.roundRobinParticipantIds ?? []).filter(
    (id) => active.has(id) && !excluded.has(id),
  );
  if (!chore.roundRobinAllMembers) return stored;
  const addedMembers = activeMemberIds
    .filter((id) => !stored.includes(id) && !excluded.has(id))
    .sort();
  return [...stored, ...addedMembers];
}
