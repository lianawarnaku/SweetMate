import type { Chore } from "../context/AppContext";
import { householdDateKey } from "./choreTimezone.ts";

/** Saved future occurrences become visible as soon as the chart is applied. */
export function upcomingHouseholdChores(chores: readonly Chore[], householdId: string | null, now: Date, timezone: string): Chore[] {
  if (!householdId || !Number.isFinite(now.getTime())) return [];
  const today = householdDateKey(now, timezone);
  return chores.filter((chore) => {
    if ((chore.householdId && chore.householdId !== householdId) || chore.completed || chore.skippedAt) return false;
    const due = new Date(chore.dueDate);
    if (!Number.isFinite(due.getTime())) return false;
    const dueDay = householdDateKey(due, timezone);
    const scheduled = chore.scheduledDate ?? dueDay;
    return dueDay > today && (!chore.recurrenceEndsOn || scheduled < chore.recurrenceEndsOn);
  }).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime() || a.id.localeCompare(b.id));
}

export function upcomingChoreDueLabel(dueDate: string, timezone: string) {
  const due = new Date(dueDate);
  return {
    date: due.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: timezone }),
    time: due.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone, timeZoneName: "short" }),
  };
}
