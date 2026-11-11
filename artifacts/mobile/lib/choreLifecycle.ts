import type { Chore } from "../context/AppContext";
import { ARCHIVE_INCOMPLETE_AFTER_DAYS } from "./choreArchivePolicy.ts";
import { householdDateKey } from "./choreTimezone.ts";
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
  if (chore.completed || chore.skippedAt || chore.choreDefinitionId) return null;
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
 * Legacy records archive after two weeks. Identity-based obligations retain
 * their owner until completion or explicit reassignment; age cannot release
 * an obligation or reveal another member’s skipped turn.
 */
export function isArchivedIncomplete(chore: Chore, now: Date): boolean {
  const boundary = incompleteArchiveBoundary(chore);
  return boundary !== null && now.getTime() >= boundary.getTime();
}

export function isActiveChore(chore: Chore, now: Date, timezone?: string): boolean {
  const dueDay = timezone ? householdDateKey(new Date(chore.dueDate),timezone) : choreLocalDateKey(chore.dueDate);
  const today = timezone ? householdDateKey(now,timezone) : choreLocalDateKey(now);
  if (chore.skippedAt || dueDay > today) return false;
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
  if (chore.skippedAt || isArchivedIncomplete(chore, now) || (chore.completed && !isRecentlyCompleted(chore, now))) return false;
  const dueKey = choreLocalDateKey(chore.dueDate);
  const todayKey = choreLocalDateKey(now);
  if (!chore.completed && dueKey && dueKey < todayKey) return true;
  const due = validDate(chore.dueDate);
  return Boolean(due && due >= startOfLocalWeek(now) && due < endOfLocalWeek(now));
}

export function activeChores(chores: Chore[], now: Date, timezone?: string): Chore[] {
  return chores.filter((chore) => isActiveChore(chore, now, timezone));
}
