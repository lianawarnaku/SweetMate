import type { Chore } from "../context/AppContext";
import type { RecurringChoreDeleteScope } from "../context/AppContext";
import { ARCHIVE_INCOMPLETE_AFTER_DAYS } from "./choreArchivePolicy.ts";
import { canonicalDefinition, sameChore } from "./choreIdentity.ts";
import { reconcileChoreObligations } from "./choreObligations.ts";
import { householdDateKey } from "./choreTimezone.ts";
export { dueDateForScheduledDate } from "./choreSchedule.ts";

export const MAX_RECURRING_OCCURRENCES_PER_PASS = 366;

export function choreLocalDateKey(value: string | Date): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function isBeforeLocalCalendarDay(
  value: string | Date,
  reference: string | Date = new Date(),
): boolean {
  const valueKey = choreLocalDateKey(value);
  const referenceKey = choreLocalDateKey(reference);
  return Boolean(valueKey && referenceKey && valueKey < referenceKey);
}

export function choreScheduledDate(chore: Chore, timezone?: string): string {
  return chore.scheduledDate ?? (timezone ? householdDateKey(new Date(chore.dueDate), timezone) : choreLocalDateKey(chore.dueDate));
}

export function recurringMaterializationFloor(throughDay: Date, timezone?: string): string {
  if (timezone) {
    const floor = new Date(`${householdDateKey(throughDay, timezone)}T12:00:00.000Z`);
    floor.setUTCDate(floor.getUTCDate() - ARCHIVE_INCOMPLETE_AFTER_DAYS);
    return floor.toISOString().slice(0, 10);
  }
  const floor = new Date(throughDay);
  floor.setDate(floor.getDate() - ARCHIVE_INCOMPLETE_AFTER_DAYS);
  return choreLocalDateKey(floor);
}

export function recurringOccurrenceId(
  householdId: string | undefined,
  recurrenceSeriesId: string,
  scheduledDate: string,
): string {
  return `occurrence:${householdId ?? "unknown"}:${recurrenceSeriesId}:${scheduledDate}`;
}

export function deleteRecurringChore(
  chores: Chore[],
  target: Chore,
  scope: RecurringChoreDeleteScope,
  changedAt: string,
): Chore[] {
  const targetDate = choreScheduledDate(target);
  const definition = canonicalDefinition(chores.filter(chore => sameChore(chore,target)));
  const stoppedDefinition = { ...definition, endsOn: targetDate, updatedAt: changedAt };
  return chores.flatMap(chore => {
    if (!sameChore(chore,target)) return [chore];
    if (scope === "series") {
      return chore.completed || chore.skippedAt ? [{ ...chore, recurrenceEndsOn: targetDate, choreDefinition: stoppedDefinition, updatedAt: changedAt }] : [];
    }
    if (scope === "future") {
      if (!chore.completed && !chore.skippedAt && choreScheduledDate(chore)>=targetDate) return [];
      return [{ ...chore, recurrenceEndsOn: targetDate, choreDefinition: stoppedDefinition, updatedAt: changedAt }];
    }
    if (chore.id === target.id) return [];
    return [{ ...chore, excludedOccurrenceDates: [...new Set([...(chore.excludedOccurrenceDates ?? []),targetDate])],updatedAt:changedAt }];
  });
}

export function choreOccurrenceIdentity(chore: Chore): string {
  return `${chore.householdId ?? "unknown"}:${chore.recurrenceSeriesId ?? chore.id}:${choreScheduledDate(chore)}`;
}

export function isChoreActiveOnDay(chore: Chore, selectedDay: Date): boolean {
  const scheduled = choreScheduledDate(chore);
  const selected = choreLocalDateKey(selectedDay);
  return !chore.completed && !chore.skippedAt && Boolean(scheduled && selected && scheduled <= selected);
}

export function isChoreCarryoverOnDay(chore: Chore, selectedDay: Date): boolean {
  return isChoreActiveOnDay(chore, selectedDay) &&
    choreScheduledDate(chore) < choreLocalDateKey(selectedDay);
}

function seriesIdsFor(chores: Chore[]): Map<string, string> {
  const parentByChild = new Map<string, string>();
  chores.forEach((chore) => {
    if (chore.nextOccurrenceId) parentByChild.set(chore.nextOccurrenceId, chore.id);
  });
  const byId = new Map(chores.map((chore) => [chore.id, chore]));
  const result = new Map<string, string>();
  chores.forEach((chore) => {
    if (!chore.recurring) return;
    if (chore.recurrenceSeriesId) {
      result.set(chore.id, chore.recurrenceSeriesId);
      return;
    }
    let root = chore;
    const seen = new Set<string>();
    while (parentByChild.has(root.id) && !seen.has(root.id)) {
      seen.add(root.id);
      const parent = byId.get(parentByChild.get(root.id)!);
      if (!parent) break;
      root = parent;
    }
    result.set(chore.id, root.id);
  });
  return result;
}

export function materializeRecurringOccurrences(
  chores: Chore[],
  throughDay: Date,
  createdAt = new Date().toISOString(),
  timezone?: string,
  activeMemberIds?: string[],
): Chore[] {
  const seriesIds = seriesIdsFor(chores);
  let changed = false;
  const normalized = chores.map(chore => {
    const seriesId = seriesIds.get(chore.id);
    if (!seriesId || chore.recurrenceSeriesId === seriesId) return chore;
    changed = true;
    return { ...chore, recurrenceSeriesId: seriesId };
  });
  return reconcileChoreObligations(changed ? normalized : chores, throughDay, createdAt, timezone, activeMemberIds);
}
