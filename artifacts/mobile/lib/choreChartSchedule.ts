import { canonicalDefinition, choreDefinitionId } from "./choreIdentity.ts";
import type {
  Chore,
  ChoreCategory,
  ChoreRecurrence,
} from "../context/AppContext";
import { choreLocalDateKey, choreScheduledDate } from "./choreOccurrences.ts";
import {
  advanceScheduledDate,
  roundRobinAssigneeAfter,
} from "./choreSchedule.ts";

export interface ChoreChartOccurrence {
  id: string;
  seriesId: string;
  title: string;
  category: ChoreCategory;
  scheduledDate: string;
  assignedTo: string;
  completed: boolean;
  projected: boolean;
  recurring?: ChoreRecurrence;
}

export interface ChoreChartWeekRow {
  id: string;
  title: string;
  category: ChoreCategory;
  recurring?: ChoreRecurrence;
  occurrenceCount: number;
  assignees: Array<{
    memberId: string;
    dates: string[];
    completedCount: number;
  }>;
}

export interface ChoreChartWeek {
  startsOn: string;
  endsOn: string;
  rows: ChoreChartWeekRow[];
}

function dayKey(value: string | Date): string {
  const key = choreLocalDateKey(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return "";
  const parsed = new Date(`${key}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === key
    ? key
    : "";
}

function utcDay(key: string): number {
  return new Date(`${key}T12:00:00Z`).getTime() / 86_400_000;
}

function addDays(key: string, days: number): string {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addMonths(key: string, months: number, anchorDay: number): string {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const finalDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12),
  ).getUTCDate();
  date.setUTCDate(Math.min(anchorDay, finalDay));
  return date.toISOString().slice(0, 10);
}

function fastForward(
  date: string,
  floor: string,
  recurrence: ChoreRecurrence,
  anchorDay: number,
): { date: string; steps: number } {
  if (date >= floor) return { date, steps: 0 };
  if (recurrence === "monthly") {
    const from = new Date(`${date}T12:00:00Z`);
    const to = new Date(`${floor}T12:00:00Z`);
    let steps = Math.max(
      0,
      (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
        to.getUTCMonth() -
        from.getUTCMonth(),
    );
    let candidate = steps ? addMonths(date, steps, anchorDay) : date;
    if (candidate < floor) {
      steps += 1;
      candidate = addMonths(date, steps, anchorDay);
    }
    return { date: candidate, steps };
  }
  const interval =
    recurrence === "daily"
      ? 1
      : recurrence === "everyOtherDay"
        ? 2
        : recurrence === "everyThreeDays"
          ? 3
          : recurrence === "biweekly"
            ? 14
            : 7;
  const steps = Math.max(
    0,
    Math.ceil((utcDay(floor) - utcDay(date)) / interval),
  );
  return { date: addDays(date, steps * interval), steps };
}

function legacySeriesIds(chores: readonly Chore[]): Map<string, string> {
  const byId = new Map(chores.map((chore) => [chore.id, chore]));
  const parentByChild = new Map(
    chores.flatMap((chore) =>
      chore.nextOccurrenceId
        ? [[chore.nextOccurrenceId, chore.id] as const]
        : [],
    ),
  );
  return new Map(
    chores.map((chore) => {
      let root = chore;
      const seen = new Set<string>();
      while (
        !root.recurrenceSeriesId &&
        parentByChild.has(root.id) &&
        !seen.has(root.id)
      ) {
        seen.add(root.id);
        const parent = byId.get(parentByChild.get(root.id)!);
        if (!parent || parent.householdId !== chore.householdId) break;
        root = parent;
      }
      return [chore.id, root.recurrenceSeriesId ?? root.id];
    }),
  );
}

/**
 * Read-only calendar view of stored occurrences and future recurrences. Past
 * history is never invented, stored assignments remain authoritative, and no
 * preview occurrence is persisted or added to completion counts.
 */
export function projectChoreChartSchedule(
  chores: readonly Chore[],
  activeMemberIds: readonly string[],
  startsOn: string | Date,
  endsOn: string | Date,
  today: string | Date = new Date(),
): ChoreChartOccurrence[] {
  const start = dayKey(startsOn);
  const end = dayKey(endsOn);
  const todayKey = dayKey(today);
  if (!start || !end || !todayKey || end < start) return [];
  const activeIds = [...new Set(activeMemberIds)];
  if (chores.some(chore => chore.choreDefinitionId)) {
    const groups = new Map<string, Chore[]>();
    chores.forEach(chore => {
      const key = JSON.stringify([chore.householdId,choreDefinitionId(chore)]);
      groups.set(key,[...(groups.get(key) ?? []),chore]);
    });
    return [...groups.values()].flatMap(group => {
      const definition = canonicalDefinition(group);
      const identity = JSON.stringify([group[0].householdId,definition.id]);
      const current = group.filter(chore => !chore.skippedAt);
      const actual: ChoreChartOccurrence[] = current.filter(chore => {
        const date=choreScheduledDate(chore); return date>=start && date<=end;
      }).map(chore => ({ id: chore.id, seriesId: identity, title: chore.title, category: chore.category,
        scheduledDate: choreScheduledDate(chore), assignedTo: chore.assignedTo, completed: chore.completed,
        projected: false, recurring: definition.recurring,
      }));
      if (!definition.recurring || current.some(chore => !chore.completed && choreScheduledDate(chore)<=todayKey)) return actual;
      const saved = new Map(group.filter(chore => (chore.recurrenceSeriesId ?? chore.id)===definition.seriesId).map(chore => [choreScheduledDate(chore),chore]));
      const relevant = group.filter(chore => (chore.recurrenceSeriesId ?? chore.id)===definition.seriesId);
      const cutoff = definition.endsOn ?? relevant.flatMap(chore => chore.recurrenceEndsOn ? [chore.recurrenceEndsOn] : []).sort()[0];
      const excluded = new Set(relevant.flatMap(chore => chore.excludedOccurrenceDates ?? []));
      const template = { ...group[0], ...definition, recurring: definition.recurring } as Chore;
      let date=definition.anchorDate, prior:Chore|undefined, priorIndex=0;
      for(let index=0; date && date<=end && index<10000; index++) {
        if(cutoff && date>=cutoff) break;
        const stored=saved.get(date);
        if(stored && stored.skippedReason!=="schedule-replaced") { prior=stored; priorIndex=index; }
        else if(date>todayKey && date>=start && !excluded.has(date) && !actual.some(chore => chore.scheduledDate===date)) {
          actual.push({ id:`preview:${identity}:${date}`,seriesId:identity,title:definition.title,category:definition.category,
            scheduledDate:date,assignedTo:definition.assignmentMode==="round-robin"
              ? roundRobinAssigneeAfter(prior ? {...template,assignedTo:prior.assignedTo,roundRobinParticipantIds:prior.roundRobinParticipantIds} : template,activeIds,prior ? index-priorIndex : index) ?? "unassigned"
              : activeIds.includes(definition.assignedTo) ? definition.assignedTo : "unassigned",
            completed:false,projected:true,recurring:definition.recurring });
        }
        const next=advanceScheduledDate(date,definition.recurring,definition.monthlyAnchorDay);
        if(!next || next<=date) break;
        date=next;
      }
      return actual;
    }).sort((a,b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.id.localeCompare(b.id));
  }
  const seriesIds = legacySeriesIds(chores);
  const groups = new Map<string, Chore[]>();
  for (const chore of chores) {
    if (!dayKey(choreScheduledDate(chore))) continue;
    const key = JSON.stringify([
      chore.householdId ?? "",
      chore.recurring ? seriesIds.get(chore.id) : chore.id,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), chore]);
  }
  const result: ChoreChartOccurrence[] = [];
  for (const [seriesId, group] of groups) {
    const byDate = new Map<string, Chore>();
    for (const chore of group) {
      const date = choreScheduledDate(chore);
      const existing = byDate.get(date);
      if (
        !existing ||
        (chore.completed && !existing.completed) ||
        (chore.completed === existing.completed &&
          ((chore.updatedAt ?? "") > (existing.updatedAt ?? "") ||
            ((chore.updatedAt ?? "") === (existing.updatedAt ?? "") &&
              chore.id.localeCompare(existing.id) < 0)))
      )
        byDate.set(date, chore);
    }
    const ordered = [...byDate.values()].sort((a, b) =>
      choreScheduledDate(a).localeCompare(choreScheduledDate(b)),
    );
    const cutoff = group
      .flatMap((chore) =>
        chore.recurrenceEndsOn ? [chore.recurrenceEndsOn] : [],
      )
      .sort()[0];
    const excluded = new Set(
      group.flatMap((chore) => chore.excludedOccurrenceDates ?? []),
    );
    const materializationFloor =
      group
        .flatMap((chore) =>
          chore.materializationStartsOn ? [chore.materializationStartsOn] : [],
        )
        .sort()
        .at(-1) ?? "";
    for (const chore of ordered) {
      const date = choreScheduledDate(chore);
      if (
        date < start ||
        date > end ||
        (!chore.completed && ((cutoff && date >= cutoff) || excluded.has(date)))
      )
        continue;
      result.push({
        id: chore.id,
        seriesId,
        title: chore.title,
        category: chore.category,
        scheduledDate: date,
        assignedTo: chore.assignedTo,
        completed: chore.completed,
        projected: false,
        recurring: chore.recurring,
      });
    }
    const floor = [start, todayKey, materializationFloor].sort().at(-1)!;
    if (floor > end || !ordered[0].recurring || (cutoff && floor >= cutoff))
      continue;
    // Begin with the latest saved occurrence before the preview. This also
    // preserves an explicit reassignment instead of restarting the rotation.
    const seed =
      [...ordered]
        .reverse()
        .find((chore) => choreScheduledDate(chore) <= floor) ?? ordered[0];
    const storedAnchorDay =
      seed.monthlyAnchorDay ??
      Number((seed.initialScheduledDate ?? choreScheduledDate(seed)).slice(-2));
    const anchorDay =
      Number.isInteger(storedAnchorDay) &&
      storedAnchorDay >= 1 &&
      storedAnchorDay <= 31
        ? storedAnchorDay
        : Number(choreScheduledDate(seed).slice(-2));
    const initial = fastForward(
      choreScheduledDate(seed),
      floor,
      seed.recurring!,
      anchorDay,
    );
    let date = initial.date;
    let step = initial.steps;
    let prior = seed;
    let priorStep = 0;
    // Bound previews even for malformed input or an unusually wide request.
    for (
      let guard = 0;
      guard < 10_000 && date && date <= end && (!cutoff || date < cutoff);
      guard += 1
    ) {
      const saved = byDate.get(date);
      if (saved) {
        prior = saved;
        priorStep = step;
      } else if (!excluded.has(date)) {
        result.push({
          id: `preview:${seriesId}:${date}`,
          seriesId,
          title: prior.title,
          category: prior.category,
          scheduledDate: date,
          assignedTo:
            roundRobinAssigneeAfter(prior, activeIds, step - priorStep) ??
            "unassigned",
          completed: false,
          projected: true,
          recurring: prior.recurring,
        });
      }
      const next = advanceScheduledDate(date, seed.recurring!, anchorDay);
      if (!next || next <= date) break;
      date = next;
      step += 1;
    }
  }
  return result.sort(
    (a, b) =>
      a.scheduledDate.localeCompare(b.scheduledDate) ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  );
}

export function choreChartWeekStart(value: string | Date): string {
  const key = dayKey(value);
  if (!key) return "";
  const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
  return addDays(key, weekday === 0 ? -6 : 1 - weekday);
}

/** One task row can show several assignees when it rotates during a week. */
export function groupChoreChartWeeks(
  occurrences: readonly ChoreChartOccurrence[],
): ChoreChartWeek[] {
  const grouped = new Map<string, Map<string, ChoreChartWeekRow>>();
  for (const occurrence of occurrences) {
    const week = choreChartWeekStart(occurrence.scheduledDate);
    const rows = grouped.get(week) ?? new Map<string, ChoreChartWeekRow>();
    const row = rows.get(occurrence.seriesId) ?? {
      id: occurrence.seriesId,
      title: occurrence.title,
      category: occurrence.category,
      recurring: occurrence.recurring,
      occurrenceCount: 0,
      assignees: [],
    };
    const assignee = row.assignees.find(
      (entry) => entry.memberId === occurrence.assignedTo,
    ) ?? {
      memberId: occurrence.assignedTo,
      dates: [],
      completedCount: 0,
    };
    assignee.dates.push(occurrence.scheduledDate);
    assignee.completedCount += Number(occurrence.completed);
    if (!row.assignees.includes(assignee)) row.assignees.push(assignee);
    row.occurrenceCount += 1;
    rows.set(row.id, row);
    grouped.set(week, rows);
  }
  return [...grouped]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([startsOn, rows]) => ({
      startsOn,
      endsOn: addDays(startsOn, 6),
      rows: [...rows.values()]
        .sort(
          (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
        )
        .map((row) => ({
          ...row,
          assignees: row.assignees.map((assignee) => ({
            ...assignee,
            dates: assignee.dates.sort(),
          })),
        })),
    }));
}

/** Return only the selected date's Monday–Sunday schedule, including empty weeks. */
export function selectChoreChartWeek(
  weeks: readonly ChoreChartWeek[],
  date: string | Date,
): ChoreChartWeek {
  const startsOn = choreChartWeekStart(date);
  return weeks.find((week) => week.startsOn === startsOn) ?? {
    startsOn,
    endsOn: startsOn ? addDays(startsOn, 6) : "",
    rows: [],
  };
}
