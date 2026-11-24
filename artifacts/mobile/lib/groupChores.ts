import type { Chore } from "../context/AppContext";
import { choreChartWeekStart } from "./choreChartSchedule.ts";
import { isRecentlyCompleted } from "./choreLifecycle.ts";
import { advanceScheduledDate } from "./choreSchedule.ts";
import { householdDateKey } from "./choreTimezone.ts";

/** Saved chores for the same Monday–Sunday household week as Group Calendar. */
export function currentHouseholdWeekChores(chores: readonly Chore[], householdId: string | null, now: Date, timezone: string): Chore[] {
  if (!householdId || !Number.isFinite(now.getTime())) return [];
  const startsOn = choreChartWeekStart(householdDateKey(now, timezone));
  const endsBefore = advanceScheduledDate(startsOn, "weekly");
  return chores.filter((chore) => {
    if ((chore.householdId && chore.householdId !== householdId) || chore.skippedAt) return false;
    const due = new Date(chore.dueDate);
    if (!Number.isFinite(due.getTime()) || (chore.completed && !isRecentlyCompleted(chore, now))) return false;
    const scheduled = chore.scheduledDate ?? householdDateKey(due, timezone);
    return scheduled >= startsOn && scheduled < endsBefore && (!chore.recurrenceEndsOn || scheduled < chore.recurrenceEndsOn);
  });
}
