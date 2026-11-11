import { householdDateKey } from "./choreTimezone.ts";
import type { Chore } from "../context/AppContext";

/** Explicit identity, scoped by household. Titles are never identity keys. */
export function choreDefinitionId(chore: Chore): string {
  return (
    chore.choreDefinitionId ??
    (chore.sourceKey
      ? `source:${chore.sourceKey}`
      : `series:${chore.recurrenceSeriesId ?? chore.id}`)
  );
}

export function sameChore(left: Chore, right: Chore): boolean {
  return (
    left.householdId === right.householdId &&
    choreDefinitionId(left) === choreDefinitionId(right)
  );
}

export type ChoreDefinition = Pick<
  Chore,
  | "title"
  | "description"
  | "category"
  | "points"
  | "recurring"
  | "assignmentMode"
  | "assignedTo"
  | "roundRobinParticipantIds"
  | "roundRobinAllMembers"
  | "excludedParticipantIds"
  | "timeOfDay"
> & {
  id: string;
  seriesId: string;
  anchorDate: string;
  anchorDueDate: string;
  monthlyAnchorDay: number;
  updatedAt: string;
  endsOn?: string;
};

export function definitionFromChore(
  chore: Chore,
  timezone?: string,
): ChoreDefinition {
  const anchorDueDate = chore.initialDueDate ?? chore.dueDate;
  const date = new Date(anchorDueDate);
  const anchorDate =
    chore.initialScheduledDate ??
    chore.scheduledDate ??
    (timezone
      ? householdDateKey(date, timezone)
      : [
          date.getFullYear(),
          String(date.getMonth() + 1).padStart(2, "0"),
          String(date.getDate()).padStart(2, "0"),
        ].join("-"));
  return {
    id: choreDefinitionId(chore),
    seriesId: chore.recurrenceSeriesId ?? chore.id,
    title: chore.title,
    description: chore.description,
    category: chore.category,
    points: chore.points,
    recurring: chore.recurring,
    assignmentMode: chore.assignmentMode,
    assignedTo: chore.assignedTo,
    roundRobinParticipantIds: chore.roundRobinParticipantIds,
    roundRobinAllMembers: chore.roundRobinAllMembers,
    excludedParticipantIds: chore.excludedParticipantIds,
    timeOfDay: chore.timeOfDay,
    anchorDate,
    anchorDueDate,
    monthlyAnchorDay: chore.monthlyAnchorDay ?? Number(anchorDate.slice(-2)),
    updatedAt: chore.createdAt ?? chore.updatedAt ?? "1970-01-01T00:00:00.000Z",
  };
}

/** An explicit edit wins; legacy schedules choose the newest series root. */
export function canonicalDefinition(
  chores: readonly Chore[],
  timezone?: string,
): ChoreDefinition {
  const explicit = chores.flatMap((chore) =>
    chore.choreDefinition ? [chore.choreDefinition] : [],
  );
  if (explicit.length)
    return [...explicit].sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.seriesId.localeCompare(b.seriesId),
    )[0];
  const roots = new Map<string, Chore>();
  for (const chore of chores) {
    const id = chore.recurrenceSeriesId ?? chore.id;
    const prior = roots.get(id);
    if (
      !prior ||
      (chore.scheduledDate ?? chore.dueDate) <
        (prior.scheduledDate ?? prior.dueDate)
    )
      roots.set(id, chore);
  }
  return definitionFromChore(
    [...roots.values()].sort(
      (a, b) =>
        (b.createdAt ?? "").localeCompare(a.createdAt ?? "") ||
        a.id.localeCompare(b.id),
    )[0],
    timezone,
  );
}
