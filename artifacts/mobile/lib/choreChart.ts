import { choreDefinitionId, definitionFromChore } from "./choreIdentity.ts";
import type {
  Chore,
  GeneratedTask,
  MemberPreference,
  ProposedChart,
} from "../context/AppContext";
import {
  buildBalancedChart,
  eligibleMemberIdsForTask,
  taskLoad,
} from "./choreEngine.ts";
import {
  advanceScheduledDate,
  resolveRoundRobinParticipants,
} from "./choreSchedule.ts";

type Member = { id: string };
export type ChartPayload = ProposedChart["payload"];

export { householdDateKey, householdDueDate } from "./choreTimezone.ts";
import { householdDateKey, householdDueDate } from "./choreTimezone.ts";

export function pointsForDifficulty(difficulty: number): number {
  return [0, 5, 10, 15, 25, 30][difficulty] ?? 15;
}

export function difficultyForPoints(
  points: number,
): GeneratedTask["difficulty"] {
  return points <= 5
    ? 1
    : points <= 10
      ? 2
      : points <= 15
        ? 3
        : points <= 25
          ? 4
          : 5;
}

function choreDay(chore: Chore, timezone: string): string {
  return (
    chore.scheduledDate ?? householdDateKey(new Date(chore.dueDate), timezone)
  );
}

/** Count work the new chart will retain, without counting future occurrences it replaces. */
export function retainedChoreLoads(
  chores: Chore[],
  members: Member[],
  now: Date,
  timezone: string,
  householdId?: string,
): Record<string, number> {
  const totals = Object.fromEntries(members.map((member) => [member.id, 0]));
  const today = householdDateKey(now, timezone);
  const recurringLoads = new Map<
    string,
    { memberIds: string[]; load: number }
  >();
  for (const chore of chores) {
    if (
      (householdId && chore.householdId !== householdId) ||
      chore.completed || chore.skippedAt ||
      !(chore.assignedTo in totals)
    )
      continue;
    const generated = Boolean(chore.sourceKey && !chore.assignmentLocked);
    if (generated && choreDay(chore, timezone) > today) continue;
    const difficulty = difficultyForPoints(chore.points);
    if (generated) {
      // Prior due occurrences survive the rebuild as one-off unfinished work.
      totals[chore.assignedTo] += difficulty;
    } else if (
      chore.recurring &&
      (!chore.recurrenceEndsOn || chore.recurrenceEndsOn > today)
    ) {
      const key = `${chore.assignmentMode === "round-robin" ? "rotation" : chore.assignedTo}:${chore.recurrenceSeriesId ?? chore.sourceKey ?? chore.id}`;
      const load = taskLoad({
        difficulty,
        frequency: chore.recurring,
      } as GeneratedTask);
      const previous = recurringLoads.get(key);
      if (!previous || previous.load < load)
        recurringLoads.set(key, {
          memberIds:
            chore.assignmentMode === "round-robin"
              ? resolveRoundRobinParticipants(
                  chore,
                  members.map((member) => member.id),
                )
              : [chore.assignedTo],
          load,
        });
    } else {
      totals[chore.assignedTo] += difficulty;
    }
  }
  recurringLoads.forEach(({ memberIds, load }) => {
    memberIds.forEach((memberId) => {
      totals[memberId] += load / memberIds.length;
    });
  });
  return totals;
}

export function buildHouseholdChart({
  tasks,
  members,
  preferences,
  chores,
  now,
  timezone,
  previous,
  householdId,
}: {
  tasks: GeneratedTask[];
  members: Member[];
  preferences: MemberPreference[];
  chores: Chore[];
  now: Date;
  timezone: string;
  householdId: string;
  previous?: ChartPayload | null;
}): ChartPayload {
  chores = chores.filter((chore) => chore.householdId === householdId);
  preferences = preferences.filter(
    (preference) => preference.householdId === householdId,
  );
  if (!tasks.length)
    throw new Error(
      "Choose at least one household feature or custom task before building a chart.",
    );
  // A saved manual schedule is an explicit override of the catalog cadence.
  tasks = tasks.map((task) => {
    const locked = chores.find(
      (chore) =>
        !chore.completed && !chore.skippedAt &&
        chore.assignmentLocked &&
        (!chore.recurrenceEndsOn ||
          chore.recurrenceEndsOn > householdDateKey(now, timezone)) &&
        chore.sourceKey === task.id,
    );
    return locked?.recurring ? { ...task, frequency: locked.recurring } : task;
  });
  const taskIds = new Set(tasks.map((task) => task.id));
  const active = new Set(members.map((member) => member.id));
  const priorManualTasks = new Set(previous?.manualAssignmentTaskIds ?? []);
  const manualAssignmentTaskIds = new Set<string>();
  const pinnedAssignments = Object.fromEntries(
    Object.entries(previous?.pinnedAssignments ?? {}).filter(
      ([taskId]) => taskIds.has(taskId) && !priorManualTasks.has(taskId),
    ),
  );
  const excludedAssignments = Object.fromEntries(
    Object.entries(previous?.excludedAssignments ?? {})
      .filter(([taskId]) => taskIds.has(taskId))
      .map(([taskId, ids]) => [taskId, ids.filter((id) => active.has(id))]),
  );
  for (const chore of chores) {
    if (
      chore.completed || chore.skippedAt ||
      (chore.recurrenceEndsOn &&
        chore.recurrenceEndsOn <= householdDateKey(now, timezone)) ||
      !chore.assignmentLocked ||
      !chore.sourceKey ||
      !taskIds.has(chore.sourceKey)
    )
      continue;
    if (!active.has(chore.assignedTo))
      throw new Error(
        `Review the manual assignment for “${chore.title}” before rebuilding.`,
      );
    const prior = pinnedAssignments[chore.sourceKey];
    if (prior && prior !== chore.assignedTo)
      throw new Error(`Manual assignments conflict for “${chore.title}”.`);
    pinnedAssignments[chore.sourceKey] = chore.assignedTo;
    manualAssignmentTaskIds.add(chore.sourceKey);
    excludedAssignments[chore.sourceKey] = [
      ...new Set([
        ...(excludedAssignments[chore.sourceKey] ?? []),
        ...(chore.excludedParticipantIds ?? []).filter((id) => active.has(id)),
      ]),
    ];
  }
  // Locked source tasks already contribute their whole ongoing workload; do
  // not charge them twice when the engine scores the proposed task as well.
  const existingLoads = retainedChoreLoads(
    chores.filter(
      (chore) =>
        !(
          chore.assignmentLocked &&
          (!chore.recurrenceEndsOn ||
            chore.recurrenceEndsOn > householdDateKey(now, timezone)) &&
          chore.sourceKey &&
          taskIds.has(chore.sourceKey)
        ),
    ),
    members,
    now,
    timezone,
    householdId,
  );
  const balanced = buildBalancedChart(tasks, members, preferences, {
    mode: "preference",
    existingLoads,
    pinnedAssignments,
    excludedAssignments,
  });
  return {
    ...balanced,
    version: 2,
    existingLoads,
    pinnedAssignments,
    excludedAssignments,
    manualAssignmentTaskIds: [...manualAssignmentTaskIds],
    rotation: "round-robin",
  };
}

/** One future anchor per task; the database retires only old future generated rows atomically. */
export function materializeApprovedChart({
  payload,
  chores,
  members,
  householdId,
  chartId,
  creatorId,
  now,
  timezone,
}: {
  payload: ChartPayload;
  chores: Chore[];
  members: Member[];
  householdId: string;
  chartId: string;
  creatorId: string;
  now: Date;
  timezone: string;
}): Chore[] {
  if (payload.version !== 2 || payload.rotation !== "round-robin")
    throw new Error(
      "This older chart must be rebuilt before it can be applied.",
    );
  const today = householdDateKey(now, timezone);
  const floor = advanceScheduledDate(today, "daily");
  const ownerByTask = new Map<string, string>();
  payload.assignments.forEach((assignment) =>
    assignment.taskIds.forEach((id) => {
      if (ownerByTask.has(id))
        throw new Error("A chart task has more than one starting assignee.");
      ownerByTask.set(id, assignment.memberId);
    }),
  );
  return (payload.generatedTasks ?? []).map((task): Chore => {
    const assignee = ownerByTask.get(task.id);
    const participants = eligibleMemberIdsForTask(task.id, members, payload);
    if (!assignee || !participants.includes(assignee))
      throw new Error(
        `The assignment for “${task.title}” is no longer eligible. Rebuild the chart.`,
      );
    const locked = chores
      .filter(
        (chore) =>
          chore.householdId === householdId &&
          !chore.completed && !chore.skippedAt &&
          chore.assignmentLocked &&
          (!chore.recurrenceEndsOn ||
            chore.recurrenceEndsOn > householdDateKey(now, timezone)) &&
          chore.sourceKey === task.id,
      )
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    if (locked)
      return {
        ...locked,
        householdId,
        excludedParticipantIds: payload.excludedAssignments?.[task.id] ?? [],
        title: task.title,
        points: pointsForDifficulty(task.difficulty),
        recurring: task.frequency,
        timeOfDay: task.timeOfDay,
        category:
          task.itemCategory === "living" || task.itemCategory === "bedroom"
            ? "cleaning"
            : task.itemCategory,
      };
    const scheduledDate = advanceScheduledDate(
      today,
      task.frequency,
      Number(today.slice(-2)),
    );
    const dueDate = householdDueDate(
      scheduledDate,
      task.timeOfDay === "morning" ? 9 : task.timeOfDay === "night" ? 20 : 12,
      timezone,
    );
    const id = `chart:${chartId}:${task.id}`;
    return {
      id,
      householdId,
      creatorId,
      title: task.title,
      sourceKey: task.id,
      choreDefinitionId: chores.find(chore => chore.sourceKey === task.id)?.choreDefinitionId ?? `source:${task.id}`,
      assignedTo: assignee,
      assignmentMode: payload.pinnedAssignments?.[task.id]
        ? "specific-person"
        : "round-robin",
      roundRobinParticipantIds: participants,
      roundRobinAllMembers: !payload.pinnedAssignments?.[task.id],
      roundRobinCursor: participants.indexOf(assignee),
      excludedParticipantIds: payload.excludedAssignments?.[task.id] ?? [],
      dueDate,
      initialDueDate: dueDate,
      nextDueDate: dueDate,
      scheduledDate,
      initialScheduledDate: scheduledDate,
      monthlyAnchorDay: Number(today.slice(-2)),
      materializationStartsOn: floor,
      completed: false,
      points: pointsForDifficulty(task.difficulty),
      category:
        task.itemCategory === "living" || task.itemCategory === "bedroom"
          ? "cleaning"
          : task.itemCategory,
      recurring: task.frequency,
      recurrenceSeriesId: id,
      occurrenceIndex: 0,
      timeOfDay: task.timeOfDay,
      assignmentLocked: false,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }).map(chore => ({ ...chore, choreDefinitionId: choreDefinitionId(chore),
    choreDefinition: { ...definitionFromChore(chore, timezone), updatedAt: now.toISOString() },
  }));
}

export function frequencyLabel(value: GeneratedTask["frequency"]): string {
  return {
    daily: "Daily",
    everyOtherDay: "Every 2 days",
    everyThreeDays: "Every 3 days",
    weekly: "Weekly",
    biweekly: "Every 2 weeks",
    monthly: "Monthly",
  }[value];
}

/** Preserve previous requests when one member changes a single task rule. */
export function withAssignmentRequest(
  payload: ChartPayload,
  taskId: string,
  memberId: string,
  kind: "always" | "never",
): ChartPayload {
  if (!(payload.generatedTasks ?? []).some((task) => task.id === taskId))
    throw new Error("This task is no longer in the chart.");
  if (payload.manualAssignmentTaskIds?.includes(taskId))
    throw new Error(
      "Edit this manual assignment in Group before changing its chart rule.",
    );
  const pinnedAssignments = { ...payload.pinnedAssignments };
  const excludedAssignments = Object.fromEntries(
    Object.entries(payload.excludedAssignments ?? {}).map(([id, members]) => [
      id,
      [...members],
    ]),
  );
  if (kind === "always") {
    pinnedAssignments[taskId] = memberId;
    excludedAssignments[taskId] = (excludedAssignments[taskId] ?? []).filter(
      (id) => id !== memberId,
    );
  } else {
    if (pinnedAssignments[taskId] === memberId)
      delete pinnedAssignments[taskId];
    excludedAssignments[taskId] = [
      ...new Set([...(excludedAssignments[taskId] ?? []), memberId]),
    ];
  }
  return { ...payload, pinnedAssignments, excludedAssignments };
}
