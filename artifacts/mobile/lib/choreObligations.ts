import type { Chore } from "../context/AppContext";
import { canonicalDefinition, choreDefinitionId } from "./choreIdentity.ts";
import {
  advanceScheduledDate,
  dueDateForScheduledDate,
  resolveRoundRobinParticipants,
  roundRobinAssigneeAfter,
} from "./choreSchedule.ts";
import { householdDateKey } from "./choreTimezone.ts";

const day = (value: string | Date, timezone?: string): string =>
  timezone
    ? householdDateKey(new Date(value), timezone)
    : typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? value
      : [
          new Date(value).getFullYear(),
          String(new Date(value).getMonth() + 1).padStart(2, "0"),
          String(new Date(value).getDate()).padStart(2, "0"),
        ].join("-");
const scheduled = (chore: Chore, timezone?: string) =>
  chore.scheduledDate ?? day(chore.dueDate, timezone);

/**
 * One open obligation per definition. Missed calendar turns are history, never
 * debt for another member. Completion does not bring the next turn forward.
 * Replaying this function is idempotent and preserves completed records.
 */
export function reconcileChoreObligations(
  chores: Chore[],
  now: Date,
  changedAt = now.toISOString(),
  timezone?: string,
  activeMemberIds?: string[],
): Chore[] {
  if (!Number.isFinite(now.getTime())) return chores;
  const today = day(now, timezone);
  const groups = new Map<string, Chore[]>();
  chores.forEach((chore) => {
    const key = JSON.stringify([
      chore.householdId ?? "unknown",
      choreDefinitionId(chore),
    ]);
    groups.set(key, [...(groups.get(key) ?? []), chore]);
  });
  const result: Chore[] = [];
  for (const group of groups.values()) {
    const definition = canonicalDefinition(group, timezone);
    const ordered = [...group].sort(
      (a, b) =>
        scheduled(a, timezone).localeCompare(scheduled(b, timezone)) ||
        (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
        a.id.localeCompare(b.id),
    );
    let outstanding: Chore | undefined;
    const normalized = ordered.map((chore) => {
      let next: Chore = {
        ...chore,
        scheduledDate: scheduled(chore, timezone),
        choreDefinitionId: definition.id,
        choreDefinition: definition,
      };
      if (!chore.completed && !chore.skippedAt) {
        if (!outstanding) outstanding = next;
        else
          next = {
            ...next,
            skippedAt: changedAt,
            skippedReason:
              scheduled(chore, timezone) > today
                ? "schedule-replaced"
                : "outstanding",
          };
      }
      if (
        !next.completed &&
        !next.skippedAt &&
        activeMemberIds &&
        next.assignedTo &&
        !activeMemberIds.includes(next.assignedTo)
      ) {
        next = { ...next, assignedTo: "", assignmentMode: "unassigned" };
        outstanding = next;
      }
      return JSON.stringify(next) === JSON.stringify(chore)
        ? chore
        : { ...next, updatedAt: changedAt };
    });
    // Later future rows are placeholders from the old eager-completion path.
    // They can be materialized again when their date actually arrives.
    const byDate = new Map<string, Chore>();
    normalized
      .filter(
        (chore) =>
          (chore.recurrenceSeriesId ?? chore.id) === definition.seriesId,
      )
      .forEach((chore) => {
        const key = scheduled(chore, timezone),
          prior = byDate.get(key);
        if (!prior || chore.completed || (!prior.completed && !chore.skippedAt))
          byDate.set(key, chore);
      });
    const template =
      ordered.find(
        (chore) =>
          (chore.recurrenceSeriesId ?? chore.id) === definition.seriesId,
      ) ?? ordered[0];
    const exclusions = new Set(
      group
        .filter(
          (chore) =>
            (chore.recurrenceSeriesId ?? chore.id) === definition.seriesId,
        )
        .flatMap((chore) => chore.excludedOccurrenceDates ?? []),
    );
    const endsOn =
      definition.endsOn ??
      group
        .filter(
          (chore) =>
            (chore.recurrenceSeriesId ?? chore.id) === definition.seriesId,
        )
        .flatMap((chore) =>
          chore.recurrenceEndsOn ? [chore.recurrenceEndsOn] : [],
        )
        .sort()[0];
    const latestCompletionDay = group
      .filter((chore) => chore.completed && chore.completedAt)
      .map((chore) => day(chore.completedAt!, timezone))
      .sort()
      .at(-1);
    // Skip unrecorded ancient history; an existing oldest obligation is never
    // archived out of ownership and still blocks all subsequent turns.
    const storedFloor = group
      .filter(
        (chore) =>
          (chore.recurrenceSeriesId ?? chore.id) === definition.seriesId,
      )
      .flatMap((chore) =>
        chore.materializationStartsOn ? [chore.materializationStartsOn] : [],
      )
      .sort()
      .at(-1);
    const floorDay = new Date(`${today}T12:00:00Z`);
    floorDay.setUTCDate(floorDay.getUTCDate() - 14);
    const rollingFloor = floorDay.toISOString().slice(0, 10);
    const floor =
      storedFloor && storedFloor > rollingFloor ? storedFloor : rollingFloor;
    if (
      definition.recurring &&
      definition.anchorDate < floor &&
      storedFloor !== floor
    ) {
      normalized.forEach((chore, index) => {
        normalized[index] = {
          ...chore,
          materializationStartsOn: floor,
          updatedAt: changedAt,
        };
      });
    }
    let date = definition.anchorDate;
    let prior: Chore | undefined;
    let priorIndex = 0;
    const participants =
      activeMemberIds ?? definition.roundRobinParticipantIds ?? [];
    const scheduleSeed = { ...template, ...definition } as Chore;
    const roster = resolveRoundRobinParticipants(scheduleSeed, participants);
    for (let index = 0; date && date <= today && index < 10000; index++) {
      if (endsOn && date >= endsOn) break;
      const existing = byDate.get(date);
      if (existing && existing.skippedReason !== "schedule-replaced") {
        prior = existing;
        priorIndex = index;
      } else if ((!floor || date >= floor) && !exclusions.has(date)) {
        const assignedTo =
          definition.assignmentMode === "round-robin"
            ? roundRobinAssigneeAfter(
                prior
                  ? {
                      ...scheduleSeed,
                      assignedTo: prior.assignedTo,
                      roundRobinParticipantIds:
                        prior.roundRobinParticipantIds ?? roster,
                    }
                  : scheduleSeed,
                participants,
                prior ? index - priorIndex : index,
              )
            : !definition.assignedTo ||
                !activeMemberIds ||
                activeMemberIds.includes(definition.assignedTo)
              ? definition.assignedTo
              : "";
        const blocked =
          Boolean(outstanding && scheduled(outstanding, timezone) <= date) ||
          Boolean(latestCompletionDay && date <= latestCompletionDay);
        const replacement: Chore = {
          ...template,
          title: definition.title,
          description: definition.description,
          category: definition.category,
          points: definition.points,
          recurring: definition.recurring,
          timeOfDay: definition.timeOfDay,
          roundRobinAllMembers: definition.roundRobinAllMembers,
          excludedParticipantIds: definition.excludedParticipantIds,
          id:
            existing?.id ??
            `occurrence:${template.householdId ?? "unknown"}:${definition.seriesId}:${date}`,
          choreDefinitionId: definition.id,
          choreDefinition: definition,
          recurrenceSeriesId: definition.seriesId,
          recurrenceEndsOn: endsOn,
          excludedOccurrenceDates: [...exclusions],
          assignedTo: assignedTo ?? "",
          assignmentMode:
            assignedTo === undefined || assignedTo === ""
              ? "unassigned"
              : definition.assignmentMode,
          roundRobinParticipantIds: roster,
          roundRobinCursor: Math.max(0, roster.indexOf(assignedTo ?? "")),
          dueDate: dueDateForScheduledDate(
            date,
            definition.anchorDueDate,
            timezone,
          ),
          initialDueDate: definition.anchorDueDate,
          initialScheduledDate: definition.anchorDate,
          scheduledDate: date,
          monthlyAnchorDay: definition.monthlyAnchorDay,
          materializationStartsOn:
            definition.anchorDate < floor
              ? floor
              : template.materializationStartsOn,
          occurrenceIndex: index,
          nextOccurrenceId: undefined,
          nextDueDate: undefined,
          completed: false,
          completedAt: undefined,
          completedByUserId: undefined,
          skippedAt: blocked ? changedAt : undefined,
          skippedReason: blocked ? "outstanding" : undefined,
          createdAt: existing?.createdAt ?? changedAt,
          updatedAt: changedAt,
        };
        const position = existing
          ? normalized.findIndex((chore) => chore.id === existing.id)
          : -1;
        if (position >= 0) normalized[position] = replacement;
        else normalized.push(replacement);
        if (!blocked) {
          if (outstanding) {
            const futureIndex = normalized.findIndex(
              (chore) => chore.id === outstanding!.id,
            );
            if (futureIndex >= 0)
              normalized[futureIndex] = {
                ...normalized[futureIndex],
                skippedAt: changedAt,
                skippedReason: "schedule-replaced",
                updatedAt: changedAt,
              };
          }
          outstanding = replacement;
        }
        prior = replacement;
        priorIndex = index;
      }
      if (!definition.recurring) break;
      const nextDate = advanceScheduledDate(
        date,
        definition.recurring,
        definition.monthlyAnchorDay,
      );
      if (nextDate <= date) break;
      date = nextDate;
    }
    result.push(...normalized);
  }
  const byId = new Map(result.map((chore) => [chore.id, chore]));
  const stable = chores.map((chore) => byId.get(chore.id)!);
  const oldIds = new Set(chores.map((chore) => chore.id));
  stable.push(...result.filter((chore) => !oldIds.has(chore.id)));
  return stable.length === chores.length &&
    stable.every((chore, index) => chore === chores[index])
    ? chores
    : stable;
}
