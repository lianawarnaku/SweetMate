import type { Chore } from "../context/AppContext";
import { ARCHIVE_INCOMPLETE_AFTER_DAYS } from "./choreArchivePolicy.ts";
import { choreLocalDateKey } from "./choreOccurrences.ts";

export const COMPLETED_CHORE_RETENTION_DAYS = 7;
export { ARCHIVE_INCOMPLETE_AFTER_DAYS } from "./choreArchivePolicy.ts";

function validDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function completedRetentionBoundary(chore: Chore): Date | null {
  const completedAt = validDate(chore.completedAt);
  if (!chore.completed || !completedAt) return null;
  const boundary = new Date(completedAt);
  boundary.setDate(boundary.getDate() + COMPLETED_CHORE_RETENTION_DAYS);
  return boundary;
}

export function incompleteArchiveBoundary(chore: Chore): Date | null {
  if (chore.completed) return null;
  const due = validDate(chore.dueDate);
  if (!due) return null;
  const boundary = new Date(due);
  boundary.setDate(boundary.getDate() + ARCHIVE_INCOMPLETE_AFTER_DAYS);
  return boundary;
}

export function isRecentlyCompleted(chore: Chore, now: Date): boolean {
  if (!chore.completed) return false;
  const boundary = completedRetentionBoundary(chore);
  // Legacy completed chores without a trustworthy timestamp remain active.
  // This avoids silently assigning an invented completion time.
  return boundary === null || now.getTime() < boundary.getTime();
}

/**
 * A chore that has sat incomplete for two weeks or more stops showing up in
 * the active lists. It is not deleted and stays fully completable/editable —
 * this only affects what My Home/Group render by default, keeping a long-
 * neglected recurring series from surfacing a wall of overdue occurrences
 * the first time the app materializes its backlog.
 */
export function isArchivedIncomplete(chore: Chore, now: Date): boolean {
  const boundary = incompleteArchiveBoundary(chore);
  return boundary !== null && now.getTime() >= boundary.getTime();
}

export function isActiveChore(chore: Chore, now: Date): boolean {
  if (isArchivedIncomplete(chore, now)) return false;
  return !chore.completed || isRecentlyCompleted(chore, now);
}

export function startOfLocalWeek(value: Date): Date {
  const start = new Date(value);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

export function endOfLocalWeek(value: Date): Date {
  const end = startOfLocalWeek(value);
  end.setDate(end.getDate() + 7);
  return end;
}

export function isChoreInCurrentWeek(chore: Chore, now: Date): boolean {
  if (!isActiveChore(chore, now)) return false;
  const dueKey = choreLocalDateKey(chore.dueDate);
  const todayKey = choreLocalDateKey(now);
  if (!chore.completed && dueKey && dueKey < todayKey) return true;
  const due = validDate(chore.dueDate);
  return Boolean(due && due >= startOfLocalWeek(now) && due < endOfLocalWeek(now));
}

export function activeChores(chores: Chore[], now: Date): Chore[] {
  return chores.filter((chore) => isActiveChore(chore, now));
}
