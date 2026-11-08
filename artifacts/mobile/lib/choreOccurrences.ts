import type { Chore } from "../context/AppContext";
import type { RecurringChoreDeleteScope } from "../context/AppContext";
import { ARCHIVE_INCOMPLETE_AFTER_DAYS } from "./choreArchivePolicy.ts";
import { advanceScheduledDate, dueDateForScheduledDate, resolveRoundRobinParticipants, roundRobinAssigneeAfter } from "./choreSchedule.ts";
import { householdDateKey } from "./choreTimezone.ts";
export { dueDateForScheduledDate } from "./choreSchedule.ts";

export const MAX_RECURRING_OCCURRENCES_PER_PASS = 366;
const MAX_RECURRENCE_STEPS_PER_PASS = 10_000;

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
  const seriesId = target.recurrenceSeriesId;
  const occurrenceIndex = target.occurrenceIndex ?? 0;
  const targetDate = choreScheduledDate(target);
  return chores.flatMap((chore) => {
    const isTarget = chore.id === target.id;
    if (!seriesId || chore.recurrenceSeriesId !== seriesId) {
      return isTarget ? [] : [chore];
    }
    // "Delete entire series" removes the recurrence going forward but must
    // not erase completed history — only incomplete occurrences (past or
    // future) are removed. A completed record, including the target itself
    // if it was already done, is kept, but stamped with the same
    // recurrenceEndsOn cutoff so the next materialization pass doesn't
    // silently regenerate occurrences for a series the user just deleted.
    if (scope === "series") {
      if (!chore.completed) return [];
      return [{
        ...chore,
        recurrenceEndsOn: targetDate,
        updatedAt: changedAt,
      }];
    }
    if (isTarget) return [];
    if (scope === "future") {
      if ((chore.occurrenceIndex ?? 0) >= occurrenceIndex) return [];
      return [{
        ...chore,
        recurrenceEndsOn: targetDate,
        updatedAt: changedAt,
      }];
    }
    return [{
      ...chore,
      excludedOccurrenceDates: [
        ...new Set([...(chore.excludedOccurrenceDates ?? []), targetDate]),
      ],
      updatedAt: changedAt,
    }];
  });
}

export function choreOccurrenceIdentity(chore: Chore): string {
  return `${chore.householdId ?? "unknown"}:${chore.recurrenceSeriesId ?? chore.id}:${choreScheduledDate(chore)}`;
}

export function isChoreActiveOnDay(chore: Chore, selectedDay: Date): boolean {
  const scheduled = choreScheduledDate(chore);
  const selected = choreLocalDateKey(selectedDay);
  return !chore.completed && Boolean(scheduled && selected && scheduled <= selected);
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
  if (!Number.isFinite(throughDay.getTime())) return chores;
  const throughKey = timezone ? householdDateKey(throughDay, timezone) : choreLocalDateKey(throughDay);
  if (!throughKey) return chores;
  const archiveFloor = recurringMaterializationFloor(throughDay, timezone);
  const seriesIds = seriesIdsFor(chores);
  let changed = false;
  const normalized = chores.map((chore) => {
    const seriesId = seriesIds.get(chore.id);
    if (!seriesId) return chore;
    const scheduledDate = choreScheduledDate(chore, timezone);
    const initialScheduledDate =
      chore.initialScheduledDate ??
      (timezone ? householdDateKey(new Date(chore.initialDueDate ?? chore.dueDate), timezone) : choreLocalDateKey(chore.initialDueDate ?? chore.dueDate));
    const monthlyAnchorDay =
      chore.monthlyAnchorDay ?? Number(initialScheduledDate.slice(-2));
    if (
      chore.recurrenceSeriesId === seriesId &&
      chore.scheduledDate === scheduledDate &&
      chore.initialScheduledDate === initialScheduledDate &&
      chore.monthlyAnchorDay === monthlyAnchorDay
    ) return chore;
    changed = true;
    return {
      ...chore,
      recurrenceSeriesId: seriesId,
      scheduledDate,
      initialScheduledDate,
      monthlyAnchorDay,
    };
  });
  const deduplicated: Chore[] = [];
  const recurringIndexByIdentity = new Map<string, number>();
  normalized.forEach((chore) => {
    if (!chore.recurring) {
      deduplicated.push(chore);
      return;
    }
    const identity = choreOccurrenceIdentity(chore);
    const existingIndex = recurringIndexByIdentity.get(identity);
    if (existingIndex === undefined) {
      recurringIndexByIdentity.set(identity, deduplicated.length);
      deduplicated.push(chore);
      return;
    }
    const existing = deduplicated[existingIndex];
    const replacement =
      chore.completed !== existing.completed
        ? chore.completed ? chore : existing
        : (chore.updatedAt ?? "") > (existing.updatedAt ?? "")
          ? chore
          : existing;
    if (replacement !== existing) deduplicated[existingIndex] = replacement;
    changed = true;
  });
  const groups = new Map<string, Chore[]>();
  deduplicated.forEach((chore) => {
    if (!chore.recurring) return;
    const seriesId = chore.recurrenceSeriesId ?? chore.id;
    const groupKey = `${chore.householdId ?? "unknown"}:${seriesId}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), chore]);
  });
  const additions: Chore[] = [];
  const deduplicatedIndexById = new Map(
    deduplicated.map((chore, index) => [chore.id, index]),
  );
  groups.forEach((series) => {
    const ordered = [...series].sort(
      (left, right) => choreScheduledDate(left).localeCompare(choreScheduledDate(right)),
    );
    const existingByDate = new Map(
      ordered.map((chore) => [choreScheduledDate(chore), chore]),
    );
    const anchor = ordered[0];
    const rotationTemplate = ordered.at(-1)!;
    const participants = activeMemberIds
      ? resolveRoundRobinParticipants(rotationTemplate, activeMemberIds)
      : (rotationTemplate.roundRobinParticipantIds ?? []).filter((id) => !(rotationTemplate.excludedParticipantIds ?? []).includes(id));
    const activeMembers = activeMemberIds ? new Set(activeMemberIds) : null;
    const seriesId = anchor.recurrenceSeriesId ?? anchor.id;
    let scheduledDate =
      anchor.initialScheduledDate ??
      choreLocalDateKey(anchor.initialDueDate ?? anchor.dueDate);
    const anchorDay =
      anchor.monthlyAnchorDay ?? Number(scheduledDate.slice(-2));
    const excludedDates = new Set(
      ordered.flatMap((chore) => chore.excludedOccurrenceDates ?? []),
    );
    const recurrenceEndsOn = ordered
      .flatMap((chore) => chore.recurrenceEndsOn ? [chore.recurrenceEndsOn] : [])
      .sort()
      .at(0);
    const storedMaterializationFloor = ordered
      .flatMap((chore) => chore.materializationStartsOn ? [chore.materializationStartsOn] : [])
      .sort()
      .at(-1);
    const effectiveMaterializationFloor =
      storedMaterializationFloor && storedMaterializationFloor > archiveFloor
        ? storedMaterializationFloor
        : archiveFloor;
    let occurrenceIndex = 0;
    let prior = anchor;
    let priorActual: Chore | undefined;
    let priorActualIndex = -1;
    const nextRotationOwner = (occurrence: number): string | undefined => {
      if (!participants.length) return undefined;
      if (priorActual) {
        return roundRobinAssigneeAfter({
          ...priorActual,
          assignmentMode: "round-robin",
          // The final cohort is already limited by the series' all-members/fixed policy.
          roundRobinAllMembers: true,
          excludedParticipantIds: rotationTemplate.excludedParticipantIds,
        }, participants, occurrence - priorActualIndex);
      }
      // Reconstruct a missing earlier slot relative to the first stored actual assignment.
      const anchorIndex = Math.max(0, participants.indexOf(anchor.assignedTo));
      const offset = occurrence - (anchor.occurrenceIndex ?? 0);
      return participants[((anchorIndex + offset) % participants.length + participants.length) % participants.length];
    };
    let additionsForSeries = 0;
    let skippedUnmaterializedHistory = false;
    for (
      let guard = 0;
      scheduledDate &&
      scheduledDate < effectiveMaterializationFloor &&
      guard < MAX_RECURRENCE_STEPS_PER_PASS;
      guard += 1
    ) {
      const existing = existingByDate.get(scheduledDate);
      if (existing) {
        prior = existing;
        priorActual = existing;
        priorActualIndex = occurrenceIndex;
      }
      else if (
        !excludedDates.has(scheduledDate) &&
        (!storedMaterializationFloor || scheduledDate >= storedMaterializationFloor)
      ) skippedUnmaterializedHistory = true;
      scheduledDate = advanceScheduledDate(
        scheduledDate,
        anchor.recurring!,
        anchorDay,
      );
      occurrenceIndex += 1;
    }
    if (skippedUnmaterializedHistory) {
      series.forEach((chore) => {
        const index = deduplicatedIndexById.get(chore.id);
        if (index === undefined) return;
        deduplicated[index] = {
          ...deduplicated[index],
          materializationStartsOn: effectiveMaterializationFloor,
          updatedAt: createdAt,
        };
      });
      prior = {
        ...prior,
        materializationStartsOn: effectiveMaterializationFloor,
      };
      changed = true;
    }
    for (let guard = 0; guard < MAX_RECURRENCE_STEPS_PER_PASS; guard += 1) {
      if (
        !scheduledDate ||
        scheduledDate > throughKey ||
        (recurrenceEndsOn && scheduledDate >= recurrenceEndsOn)
      ) break;
      const existing = existingByDate.get(scheduledDate);
      if (!existing && !excludedDates.has(scheduledDate)) {
        const assignedTo = rotationTemplate.assignmentMode === "round-robin"
          ? nextRotationOwner(occurrenceIndex)
          : prior.assignedTo;
        // Keep history, but wait for an assignment review if nobody eligible remains.
        const canAssign = assignedTo !== undefined &&
          (!assignedTo || !activeMembers || activeMembers.has(assignedTo));
        if (!canAssign) {
          scheduledDate = advanceScheduledDate(scheduledDate, anchor.recurring!, anchorDay);
          occurrenceIndex += 1;
          continue;
        }
        const cursor = Math.max(0, participants.indexOf(assignedTo));
        const addition: Chore = {
          ...prior,
          id: recurringOccurrenceId(
            anchor.householdId,
            seriesId,
            scheduledDate,
          ),
          assignedTo,
          roundRobinParticipantIds: rotationTemplate.assignmentMode === "round-robin" ? participants : prior.roundRobinParticipantIds,
          excludedParticipantIds: rotationTemplate.excludedParticipantIds,
          roundRobinAllMembers: rotationTemplate.roundRobinAllMembers,
          assignmentMode: rotationTemplate.assignmentMode,
          roundRobinCursor: cursor,
          dueDate: dueDateForScheduledDate(
            scheduledDate,
            anchor.initialDueDate ?? anchor.dueDate,
            timezone,
          ),
          scheduledDate,
          initialScheduledDate:
            anchor.initialScheduledDate ??
            choreLocalDateKey(anchor.initialDueDate ?? anchor.dueDate),
          monthlyAnchorDay: anchorDay,
          nextDueDate: dueDateForScheduledDate(
            scheduledDate,
            anchor.initialDueDate ?? anchor.dueDate,
            timezone,
          ),
          completed: false,
          completedAt: undefined,
          completedByUserId: undefined,
          recurrenceSeriesId: seriesId,
          occurrenceIndex,
          nextOccurrenceId: undefined,
          createdAt,
          updatedAt: createdAt,
        };
        additions.push(addition);
        additionsForSeries += 1;
        existingByDate.set(scheduledDate, addition);
        prior = addition;
        priorActual = addition;
        priorActualIndex = occurrenceIndex;
        changed = true;
      } else if (existing) {
        prior = existing;
        priorActual = existing;
        priorActualIndex = occurrenceIndex;
      }
      scheduledDate = advanceScheduledDate(
        scheduledDate,
        anchor.recurring!,
        anchorDay,
      );
      occurrenceIndex += 1;
      if (additionsForSeries >= MAX_RECURRING_OCCURRENCES_PER_PASS) break;
    }
  });
  return changed ? [...deduplicated, ...additions] : chores;
}
