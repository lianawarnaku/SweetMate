import { upcomingHouseholdChores } from "./upcomingChores.ts";
import { choreChartReviewState, choreChartReviewSubmission, parseChoreChartReviewSnapshot, type ChoreChartReviewDraft } from "./choreChartReview.ts";
import { chartApprovalProgress } from "./chartApprovals.ts";
import { strict as assert } from "node:assert";
import type {
  Chore,
  GeneratedTask,
  MemberPreference,
  ProposedChart,
} from "../context/AppContext";
import {
  buildHouseholdChart,
  averageWeeklyWorkloads,
  difficultyForPoints,
  frequencyLabel,
  householdDateKey,
  householdDueDate,
  materializeApprovedChart,
  pointsForDifficulty,
  retainedChoreLoads,
  withAssignmentRequest,
  type ChartPayload,
} from "./choreChart.ts";
import { materializeRecurringOccurrences } from "./choreOccurrences.ts";
import { resolveRoundRobinParticipants } from "./choreSchedule.ts";

const householdId = "home-a";
const members = [{ id: "a" }, { id: "b" }, { id: "c" }];
const twoMembers = members.slice(0, 2);
const now = new Date("2026-07-27T14:00:00.000Z");
const timezone = "America/New_York";
function task(
  id: string,
  overrides: Partial<GeneratedTask> = {},
): GeneratedTask {
  return {
    id,
    title: id,
    item: id,
    itemCategory: "other",
    difficulty: 1,
    frequency: "weekly",
    timeOfDay: "any",
    ...overrides,
  };
}
function chore(id: string, overrides: Partial<Chore> = {}): Chore {
  return {
    id,
    householdId,
    creatorId: "a",
    title: id,
    assignedTo: "a",
    dueDate: "2026-07-27T16:00:00.000Z",
    scheduledDate: "2026-07-27",
    completed: false,
    points: 15,
    category: "other",
    ...overrides,
  };
}
function build(
  tasks: GeneratedTask[],
  overrides: Partial<Parameters<typeof buildHouseholdChart>[0]> = {},
) {
  return buildHouseholdChart({
    householdId,
    tasks,
    members: twoMembers,
    preferences: [],
    chores: [],
    now,
    timezone,
    ...overrides,
  });
}
function materialize(
  payload: ChartPayload,
  overrides: Partial<Parameters<typeof materializeApprovedChart>[0]> = {},
) {
  return materializeApprovedChart({
    payload,
    chores: [],
    members: twoMembers,
    householdId,
    chartId: "new-chart",
    creatorId: "a",
    now,
    timezone,
    ...overrides,
  });
}
function owner(payload: ChartPayload, taskId: string): string | undefined {
  return payload.assignments.find((assignment) =>
    assignment.taskIds.includes(taskId),
  )?.memberId;
}
function approximately(actual: number, expected: number, message: string) {
  assert.ok(
    Math.abs(actual - expected) < 1e-8,
    `${message}: expected ${expected}, got ${actual}`,
  );
}

assert.deepEqual([1, 2, 3, 4, 5].map(pointsForDifficulty), [5, 10, 15, 25, 30]);
assert.deepEqual([5, 10, 15, 25, 30].map(difficultyForPoints), [1, 2, 3, 4, 5]);
const weighted = build([
  task("daily-heavy", { difficulty: 5, frequency: "daily" }),
  task("weekly-light"),
]);
approximately(
  weighted.memberLoads!.reduce((sum, member) => sum + member.totalLoad, 0),
  36,
  "chart workload must reflect item difficulty multiplied by recurrence frequency",
);
assert.equal(weighted.version, 2);
assert.equal(weighted.rotation, "round-robin");
const preferredTasks = [
  task("morning", { difficulty: 3, timeOfDay: "morning" }),
  task("night", { difficulty: 3, timeOfDay: "night" }),
];
const preferences: MemberPreference[] = [
  { householdId, memberId: "a", key: "morning", value: 100 },
  { householdId, memberId: "a", key: "night", value: 0 },
  { householdId, memberId: "b", key: "morning", value: 0 },
  { householdId, memberId: "b", key: "night", value: 100 },
];
const preferred = build(preferredTasks, { preferences });
assert.equal(owner(preferred, "morning"), "a");
assert.equal(owner(preferred, "night"), "b");
const swapped = build(preferredTasks, {
  preferences: preferences.map((entry) => ({
    ...entry,
    value: 100 - entry.value,
  })),
});
assert.equal(
  owner(swapped, "morning"),
  "b",
  "saved preference changes must affect first-assignment selection",
);
assert.equal(owner(swapped, "night"), "a");

const retained = [
  chore("manual-future", { points: 15, scheduledDate: "2026-08-10" }),
  chore("manual-daily-1", {
    points: 10,
    recurring: "daily",
    recurrenceSeriesId: "manual-daily",
  }),
  chore("manual-daily-2", {
    points: 10,
    recurring: "daily",
    recurrenceSeriesId: "manual-daily",
    scheduledDate: "2026-07-28",
  }),
  chore("manual-monthly", {
    assignedTo: "b",
    points: 25,
    recurring: "monthly",
  }),
  chore("generated-overdue", {
    sourceKey: "old-source",
    points: 25,
    scheduledDate: "2026-07-26",
  }),
  chore("generated-today", {
    assignedTo: "b",
    sourceKey: "another-old-source",
    points: 5,
  }),
  chore("generated-future", {
    sourceKey: "future-source",
    points: 30,
    scheduledDate: "2026-07-28",
  }),
  chore("completed", {
    sourceKey: "completed-source",
    points: 30,
    completed: true,
    completedAt: now.toISOString(),
  }),
  chore("inactive-owner", { assignedTo: "removed", points: 30 }),
];
const retainedBefore = structuredClone(retained);
const loads = retainedChoreLoads(
  retained,
  twoMembers,
  now,
  timezone,
  householdId,
);
approximately(
  loads.a,
  21,
  "manual recurring work counts once; unfinished generated work counts as retained one-off load",
);
approximately(
  loads.b,
  1 + (4 * 12) / 52,
  "retained monthly load must use the same frequency units as generated work",
);
const withBacklog = build([task("fresh", { difficulty: 4 })], {
  chores: retained,
});
assert.equal(
  owner(withBacklog, "fresh"),
  "b",
  "unfinished/manual workload must influence the new assignment",
);
assert.deepEqual(
  retained,
  retainedBefore,
  "chart generation must never mutate completed or retained history",
);

const requestsBase = build([task("rotate"), task("another")], { members });
const requestsSnapshot = structuredClone(requestsBase);
let requests = withAssignmentRequest(requestsBase, "rotate", "b", "never");
requests = withAssignmentRequest(requests, "another", "c", "always");
requests = withAssignmentRequest(requests, "rotate", "c", "never");
assert.deepEqual(requests.excludedAssignments?.rotate, ["b", "c"]);
assert.equal(
  requests.pinnedAssignments?.another,
  "c",
  "a second request must retain unrelated earlier rules",
);
assert.deepEqual(
  requestsBase,
  requestsSnapshot,
  "requests must not mutate the prior proposal or its nested arrays",
);
const requested = build(requests.generatedTasks!, {
  members,
  previous: requests,
});
assert.equal(owner(requested, "rotate"), "a");
assert.equal(owner(requested, "another"), "c");
const reversed = withAssignmentRequest(requests, "rotate", "b", "always");
assert.equal(reversed.pinnedAssignments?.rotate, "b");
assert.deepEqual(
  reversed.excludedAssignments?.rotate,
  ["c"],
  "Always me must clear only that member's conflicting exclusion",
);
const neverAgain = withAssignmentRequest(reversed, "rotate", "b", "never");
assert.ok(!neverAgain.pinnedAssignments?.rotate);
assert.deepEqual(neverAgain.excludedAssignments?.rotate, ["c", "b"]);
assert.throws(
  () => withAssignmentRequest(requests, "missing", "a", "never"),
  /no longer in the chart/,
);
assert.throws(() => build([]), /at least one/);
assert.throws(() => build([task("task")], { members: [] }), /member/i);
assert.throws(
  () =>
    build([task("task")], {
      previous: { ...requestsBase, pinnedAssignments: { task: "removed" } },
    }),
  /pinned member/i,
);
assert.throws(
  () =>
    build([task("task")], {
      previous: { ...requestsBase, excludedAssignments: { task: ["a", "b"] } },
    }),
  /No eligible member/,
);
const pruned = build([task("task")], {
  previous: {
    ...requestsBase,
    pinnedAssignments: { vanished: "removed" },
    excludedAssignments: { vanished: ["a"] },
  },
});
assert.deepEqual(pruned.pinnedAssignments, {});
assert.deepEqual(pruned.excludedAssignments, {});

const lockedTask = task("locked", {
  itemCategory: "laundry",
  difficulty: 4,
  frequency: "weekly",
  timeOfDay: "night",
});
const locked = chore("manual-locked-id", {
  sourceKey: lockedTask.id,
  title: "Old title",
  points: 10,
  assignmentLocked: true,
  assignmentMode: "specific-person",
  recurring: "biweekly",
  dueDate: "2026-07-24T19:15:32.125Z",
  initialDueDate: "2026-07-10T19:15:32.125Z",
  scheduledDate: "2026-07-24",
  initialScheduledDate: "2026-07-10",
  recurrenceSeriesId: "manual-series",
  description: "Keep this manual note",
  creatorId: "original-creator",
  excludedOccurrenceDates: ["2026-08-07"],
});
const lockedPayload = build([lockedTask], { chores: [locked] });
assert.equal(lockedPayload.pinnedAssignments?.locked, "a");
assert.equal(
  lockedPayload.existingLoads?.a,
  0,
  "a locked source task must not be charged again as existing load",
);
assert.equal(
  lockedPayload.generatedTasks?.[0].frequency,
  "biweekly",
  "manual locked cadence must survive registry/default rebuilds",
);
const refreshedLocked = materialize(lockedPayload, { chores: [locked] })[0];
for (const key of [
  "id",
  "dueDate",
  "scheduledDate",
  "initialDueDate",
  "initialScheduledDate",
  "recurrenceSeriesId",
  "description",
  "creatorId",
  "assignedTo",
] as const) {
  assert.equal(
    refreshedLocked[key],
    locked[key],
    `rebuild must preserve locked ${key}`,
  );
}
assert.equal(refreshedLocked.title, lockedTask.title);
assert.equal(refreshedLocked.points, 25);
assert.equal(refreshedLocked.category, "laundry");
assert.equal(refreshedLocked.recurring, "biweekly");
assert.equal(refreshedLocked.assignmentLocked, true);
assert.deepEqual(refreshedLocked.excludedOccurrenceDates, ["2026-08-07"]);
assert.throws(
  () =>
    build([lockedTask], {
      chores: [locked],
      previous: { ...requestsBase, pinnedAssignments: { locked: "b" } },
    }),
  /conflict/,
);
assert.throws(
  () => build([lockedTask], { chores: [{ ...locked, assignedTo: "removed" }] }),
  /manual assignment/,
);

const endedLock = { ...locked, recurrenceEndsOn: "2026-07-27" };
const afterEndedLock = build([lockedTask], { chores: [endedLock] });
assert.deepEqual(
  afterEndedLock.pinnedAssignments,
  {},
  "an ended manual series must not pin a fresh chart forever",
);
assert.equal(
  afterEndedLock.generatedTasks?.[0].frequency,
  "weekly",
  "an ended manual cadence must not override a new task's cadence",
);
assert.notEqual(
  materialize(afterEndedLock, { chores: [endedLock] })[0].id,
  endedLock.id,
  "a fresh chart must not reuse the identity or cutoff of an ended locked series",
);
const completedLock = build([lockedTask], {
  chores: [{ ...locked, completed: true }],
});
assert.deepEqual(
  completedLock.pinnedAssignments,
  {},
  "completed locked history must not constrain new assignments",
);

const datedTasks: GeneratedTask[] = [
  task("daily", { frequency: "daily", timeOfDay: "morning" }),
  task("two", { frequency: "everyOtherDay" }),
  task("three", { frequency: "everyThreeDays", timeOfDay: "night" }),
  task("weekly", { frequency: "weekly" }),
  task("biweekly", { frequency: "biweekly" }),
  task("monthly", { frequency: "monthly", itemCategory: "bedroom" }),
];
const januaryNow = new Date("2026-01-31T22:00:00.000Z");
const datesPayload = build(datedTasks, { now: januaryNow });
const dated = materialize(datesPayload, { now: januaryNow });
const expectedDates = {
  daily: "2026-02-01",
  two: "2026-02-02",
  three: "2026-02-03",
  weekly: "2026-02-07",
  biweekly: "2026-02-14",
  monthly: "2026-02-28",
};
for (const entry of dated) {
  assert.equal(
    entry.scheduledDate,
    expectedDates[entry.sourceKey as keyof typeof expectedDates],
  );
  assert.equal(
    entry.materializationStartsOn,
    "2026-02-01",
    "a rebuilt chart must start after today's existing chores",
  );
  assert.equal(entry.householdId, householdId);
  assert.equal(entry.recurrenceSeriesId, entry.id);
  assert.equal(entry.occurrenceIndex, 0);
}
assert.equal(
  dated.find((entry) => entry.sourceKey === "monthly")?.monthlyAnchorDay,
  31,
);
assert.equal(
  dated.find((entry) => entry.sourceKey === "monthly")?.category,
  "cleaning",
);
assert.equal(
  dated.find((entry) => entry.sourceKey === "three")?.dueDate,
  "2026-02-04T01:00:00.000Z",
);
assert.equal(
  householdDateKey(new Date("2026-07-28T00:30:00.000Z"), "America/Los_Angeles"),
  "2026-07-27",
);
assert.equal(
  householdDueDate("2026-03-07", 9, timezone),
  "2026-03-07T14:00:00.000Z",
);
assert.equal(
  householdDueDate("2026-03-08", 9, timezone),
  "2026-03-08T13:00:00.000Z",
);
assert.equal(
  householdDueDate("2026-11-01", 9, timezone),
  "2026-11-01T14:00:00.000Z",
);
assert.equal(frequencyLabel("everyThreeDays"), "Every 3 days");
assert.equal(frequencyLabel("biweekly"), "Every 2 weeks");
const laPayload = build(
  [task("daily", { frequency: "daily", timeOfDay: "morning" })],
  {
    now: new Date("2026-07-28T00:30:00.000Z"),
    timezone: "America/Los_Angeles",
  },
);
assert.equal(
  materialize(laPayload, {
    now: new Date("2026-07-28T00:30:00.000Z"),
    timezone: "America/Los_Angeles",
  })[0].dueDate,
  "2026-07-28T16:00:00.000Z",
  "device UTC midnight must not shift the household's initial calendar date",
);

const rotateTask = task("rotation", { frequency: "daily" });
const rotationBase = build([rotateTask], { members });
const neverB = withAssignmentRequest(rotationBase, rotateTask.id, "b", "never");
const rotationPayload = build([rotateTask], { members, previous: neverB });
const rotationAnchor = materialize(rotationPayload, { members })[0];
assert.deepEqual(rotationAnchor.roundRobinParticipantIds, ["a", "c"]);
assert.deepEqual(rotationAnchor.excludedParticipantIds, ["b"]);
const rotated = materializeRecurringOccurrences(
  [rotationAnchor],
  new Date(2026, 7, 2, 12),
  "2026-08-02T18:00:00.000Z",
  timezone,
  members.map((member) => member.id),
);
assert.ok(rotated.length >= 5);
assert.ok(
  rotated.every((entry) => entry.assignedTo !== "b"),
  "Never me must constrain every real future occurrence",
);
assert.equal(new Set(rotated.map((entry) => entry.assignedTo)).size, 2);
const addedMembers = [...members, { id: "d" }];
const expandedAnchor = {
  ...rotationAnchor,
  roundRobinParticipantIds: resolveRoundRobinParticipants(
    rotationAnchor,
    addedMembers.map((member) => member.id),
  ),
};
const expanded = materializeRecurringOccurrences(
  [expandedAnchor],
  new Date(2026, 7, 3, 12),
  "2026-08-03T18:00:00.000Z",
  timezone,
  addedMembers.map((member) => member.id),
);
assert.ok(
  expanded.some((entry) => entry.assignedTo === "d"),
  "new active members must join an all-member rotation",
);
assert.ok(expanded.every((entry) => entry.assignedTo !== "b"));
const alwaysA = build([rotateTask], {
  members,
  previous: withAssignmentRequest(neverB, rotateTask.id, "a", "always"),
});
const fixed = materialize(alwaysA, { members });
assert.equal(fixed[0].assignmentMode, "specific-person");
const pinnedFuture = materializeRecurringOccurrences(
  fixed,
  new Date(2026, 7, 2, 12),
  "2026-08-02T18:00:00.000Z",
  timezone,
  members.map((member) => member.id),
);
assert.ok(
  pinnedFuture.length >= 5 &&
    pinnedFuture.every((entry) => entry.assignedTo === "a"),
  "Always me must pin all real future occurrences as well as the chart's first assignment",
);
const historySnapshot = structuredClone(retained);
materialize(rotationPayload, { members, chores: retained });
assert.deepEqual(retained, historySnapshot);
assert.throws(
  () => materialize({ ...rotationPayload, version: undefined }),
  /older chart/,
);
assert.throws(
  () =>
    materialize({
      ...rotationPayload,
      assignments: [
        { memberId: "a", taskIds: [rotateTask.id], totalLoad: 1 },
        { memberId: "b", taskIds: [rotateTask.id], totalLoad: 1 },
      ],
    }),
  /more than one/,
);
assert.throws(
  () => materialize({ ...rotationPayload, assignments: [] }),
  /no longer eligible/,
);
assert.throws(
  () => materialize(rotationPayload, { members: [{ id: "removed" }] }),
  /no longer eligible/,
);

const foreignChores = [
  chore("foreign-manual", { householdId: "home-b", points: 30 }),
  chore("foreign-locked", {
    ...locked,
    id: "foreign-locked",
    householdId: "home-b",
  }),
  chore("legacy-unscoped", { householdId: undefined, points: 30 }),
];
const isolated = build([lockedTask], { chores: foreignChores });
assert.deepEqual(
  isolated.existingLoads,
  { a: 0, b: 0 },
  "other homes and unscoped rows must not influence this chart's retained load",
);
assert.deepEqual(
  isolated.pinnedAssignments,
  {},
  "foreign locked assignments must not become household pins",
);
const scopedRow = materialize(isolated, { chores: foreignChores })[0];
assert.notEqual(
  scopedRow.id,
  "foreign-locked",
  "foreign source keys must never import foreign chore identity into this household",
);
assert.equal(scopedRow.creatorId, "a");
assert.equal(scopedRow.householdId, householdId);
const isolatedPreferences = build(preferredTasks, {
  preferences: [
    ...preferences,
    ...preferences.map((entry) => ({
      ...entry,
      householdId: "home-b",
      value: 100 - entry.value,
    })),
  ],
});
assert.equal(
  owner(isolatedPreferences, "morning"),
  "a",
  "a roommate's preferences in another home must not override current-household preferences",
);
assert.equal(owner(isolatedPreferences, "night"), "b");

const changedAfterAlways = build([rotateTask], {
  members,
  chores: fixed,
  previous: withAssignmentRequest(alwaysA, rotateTask.id, "a", "never"),
});
assert.ok(
  !changedAfterAlways.pinnedAssignments?.[rotateTask.id],
  "Always-me rules must remain changeable after chart application",
);
assert.ok(
  materialize(changedAfterAlways, {
    members,
    chores: fixed,
  })[0].roundRobinParticipantIds?.every((id) => id !== "a"),
);
const endedAfterManualChart = build([lockedTask], {
  chores: [endedLock],
  previous: lockedPayload,
});
assert.ok(
  !endedAfterManualChart.pinnedAssignments?.locked,
  "an automatic manual pin must not survive the end of its manual series",
);
assert.throws(
  () => withAssignmentRequest(lockedPayload, "locked", "b", "always"),
  /manual assignment/,
);

const manualRotation = chore("manual-rotate-a", {
  assignmentMode: "round-robin",
  recurring: "daily",
  recurrenceSeriesId: "manual-rotation",
  roundRobinParticipantIds: ["a", "b"],
  points: 10,
});
const manualRotationLoads = retainedChoreLoads(
  [
    manualRotation,
    {
      ...manualRotation,
      id: "manual-rotate-b",
      assignedTo: "b",
      scheduledDate: "2026-07-28",
    },
  ],
  twoMembers,
  now,
  timezone,
  householdId,
);
assert.deepEqual(
  manualRotationLoads,
  { a: 7, b: 7 },
  "retained rotating work is shared once across its eligible members, rather than counted in full for each stored owner",
);
console.log("Household chart behavior tests passed");

// A recurring task is shared over the full rotation, not charged only to its first assignee.
const sampleTasks = [
  task("dishwasher-night", { difficulty: 2, frequency: "daily", timeOfDay: "night", keepTogetherGroup: "legacy-dishwasher" }),
  task("dishwasher-morning", { difficulty: 2, frequency: "daily", timeOfDay: "morning", keepTogetherGroup: "legacy-dishwasher" }),
  task("filter", { difficulty: 2, frequency: "monthly" }),
  task("kettle", { difficulty: 3, frequency: "monthly" }),
  task("shelves", { difficulty: 4, frequency: "monthly" }),
  task("basket", { difficulty: 2, frequency: "monthly" }),
  task("vacuum", { difficulty: 3, frequency: "weekly" }),
];
const sample = build(sampleTasks);
assert.notEqual(owner(sample, "dishwasher-morning"), owner(sample, "dishwasher-night"), "even neutral preferences must allow distinct starting assignees for the daily dishwasher chores");
const weeklyFor = (payload: ChartPayload, extraChores: Chore[] = [], roster = twoMembers) => averageWeeklyWorkloads({ payload, chores: extraChores, members: roster, householdId, now, timezone });
const sampleWeekly = weeklyFor(sample)!;
approximately(sampleWeekly.a, (28 + 11 * 12 / 52 + 3) / 2, "Avery's average must include half of every rotating chore");
approximately(sampleWeekly.b, sampleWeekly.a, "equally eligible members must have equal average shares regardless of starting turns");
assert.deepEqual(weeklyFor({ ...sample, assignments: [...sample.assignments].reverse() }), sampleWeekly, "the display must not depend on who is listed first");

const constrainedWeeklyBase = build([task("daily-share", { difficulty: 2, frequency: "daily" }), task("fixed-weekly", { difficulty: 3 })], { members });
let weeklyRequests = withAssignmentRequest(constrainedWeeklyBase, "fixed-weekly", "c", "always");
weeklyRequests = withAssignmentRequest(weeklyRequests, "daily-share", "c", "never");
const constrainedWeekly = weeklyFor(weeklyRequests, [], members)!;
approximately(constrainedWeekly.a, 7, "Never me must divide rotating effort only between eligible members");
approximately(constrainedWeekly.b, 7, "remaining members must receive the excluded person's rotating share");
approximately(constrainedWeekly.c, 3, "Always me must count the full task against its fixed assignee");

const retainedWeeklyPayload = build([task("planned", { difficulty: 4 })]);
const ongoing = [
  chore("external-daily", { recurring: "daily", points: 10, recurrenceSeriesId: "external-series" }),
  chore("external-daily-copy", { recurring: "daily", points: 10, recurrenceSeriesId: "external-series", scheduledDate: "2026-07-28" }),
  chore("external-rotating", { recurring: "weekly", points: 25, assignmentMode: "round-robin", roundRobinParticipantIds: ["a", "b"] }),
  chore("one-off-backlog", { points: 30 }),
  chore("generated-backlog", { sourceKey: "old-source", points: 30, recurring: "daily" }),
  chore("expired-recurring", { points: 30, recurring: "daily", recurrenceEndsOn: "2026-07-26" }),
  chore("completed-recurring", { points: 30, recurring: "daily", completed: true }),
  chore("other-household", { householdId: "other", points: 30, recurring: "daily" }),
  chore("planned-anchor", { sourceKey: "planned", assignmentLocked: true, recurring: "weekly", points: 25 }),
];
const weeklyRetained = weeklyFor(retainedWeeklyPayload, ongoing)!;
approximately(weeklyRetained.a, 18, "include retained recurring effort once, without one-off backlog or duplicate chart anchors");
approximately(weeklyRetained.b, 4, "external recurring rotations must use their participant lists");
assert.equal(weeklyFor({ ...sample, version: undefined }), null, "older non-rotating proposals must request a rebuild rather than relabel starting loads");
assert.equal(weeklyFor({ ...sample, pinnedAssignments: { "dishwasher-night": "departed" } }), null, "stale membership constraints must not crash the workload display");

const approvalRoster = [{ id: "a", name: "Avery" }, { id: "b", name: "Blake" }];
const approvalRows = [
  { id: "old", proposedChartId: "old", memberId: "a", approved: true, approvedAt: "" },
  { id: "current", proposedChartId: "new", memberId: "b", approved: true, approvedAt: "" },
  { id: "departed", proposedChartId: "new", memberId: "removed", approved: true, approvedAt: "" },
];
const approvalProgress = chartApprovalProgress("new", approvalRoster, approvalRows);
assert.equal(approvalProgress.totalCount, 2, "departed members must not appear in the active approval list");
assert.equal(approvalProgress.approvedCount, 1, "votes from previous versions must not count");
assert.deepEqual(approvalProgress.rows.map((row) => row.approved), [false, true]);
assert.equal(chartApprovalProgress("next-revision", approvalRoster, approvalRows).approvedCount, 0, "a new revision must show every member pending until its own votes arrive");


// Reviewing an unchanged proposal must approve that version, rather than
// replace it and silently reset the other Sweetmates' votes.
const reviewSharedChart: ProposedChart = {
  id: "new", householdId, createdBy: "a", status: "pending",
  payload: sample, createdAt: now.toISOString(),
};
const reviewDraft: ChoreChartReviewDraft = {
  householdId, payload: sample, baseChartId: "new", approvedChartId: null,
};
const reviewState = (draft = reviewDraft, currentChart: ProposedChart | null = reviewSharedChart, inputsChanged = false, activeHousehold: string | null = householdId) => choreChartReviewState({ draft, currentChart, householdId: activeHousehold, inputsChanged });
assert.deepEqual(reviewState(), { kind: "pending", chartId: "new" });
assert.equal(chartApprovalProgress(reviewState().chartId, approvalRoster, approvalRows).approvedCount, 1, "an unchanged preview must preserve the exact proposal's existing votes");
const reorderedPayload = Object.fromEntries(Object.entries(sample).reverse()) as ChartPayload;
assert.deepEqual(reviewState({ ...reviewDraft, payload: reorderedPayload }), { kind: "pending", chartId: "new" }, "jsonb key ordering must not reset approvals");
const changedPayload = { ...sample, pinnedAssignments: { [sampleTasks[0].id]: "a" } };
assert.deepEqual(reviewState({ ...reviewDraft, payload: changedPayload }), { kind: "draft", chartId: null });
assert.equal(chartApprovalProgress(null, approvalRoster, approvalRows).approvedCount, 0, "an unsent revision must show everyone Pending instead of borrowing an old chart's votes");
assert.deepEqual(reviewState({ ...reviewDraft, baseChartId: null }, null), { kind: "draft", chartId: null }, "a first preview must remain unsent until Approve");
assert.equal(reviewState(reviewDraft, reviewSharedChart, true).kind, "stale", "changed creator inputs must require a fresh preview");
assert.equal(reviewState(reviewDraft, { ...reviewSharedChart, id: "newer", payload: changedPayload }).kind, "stale", "a concurrent revision cannot be approved through the old preview");
assert.equal(reviewState({ ...reviewDraft, payload: changedPayload }, { ...reviewSharedChart, id: "newer" }).kind, "stale", "a stale draft must not replace a newer shared version");
assert.equal(reviewState(reviewDraft, { ...reviewSharedChart, status: "cancelled" }).kind, "stale", "cancelled proposals cannot be approved");
assert.equal(reviewState(reviewDraft, reviewSharedChart, false, "other-household").kind, "stale", "a preview cannot approve chores in another household");
assert.deepEqual(reviewState({ ...reviewDraft, approvedChartId: "new" }, { ...reviewSharedChart, status: "approved" }, true), { kind: "approved", chartId: "new" }, "applying a just-approved chart changes chores without closing the review");
assert.equal(reviewState({ ...reviewDraft, approvedChartId: "new" }, { ...reviewSharedChart, id: "newer" }).kind, "stale", "a later shared version cannot inherit the local confirmed approval");
console.log("Chore chart preview approval review tests passed");


// Permanent preferences can be chosen before a first proposal exists. Both
// setup-generated and custom tasks use the same constraint/rebuild path.
const creatorRuleTasks = [
  task("setup-generated", { difficulty: 2, frequency: "daily" }),
  task("custom-task", { difficulty: 3 }),
  task("preserved-rule"),
];
const creatorSeed = build(creatorRuleTasks);
const creatorSeedSnapshot = structuredClone(creatorSeed);
let creatorRequests = withAssignmentRequest(creatorSeed, "preserved-rule", "b", "always");
creatorRequests = withAssignmentRequest(creatorRequests, "setup-generated", "a", "always");
creatorRequests = withAssignmentRequest(creatorRequests, "custom-task", "a", "never");
const creatorRulePreview = build(creatorRuleTasks, { previous: creatorRequests });
assert.equal(owner(creatorRulePreview, "setup-generated"), "a", "Always me must affect the first generated preview");
assert.equal(owner(creatorRulePreview, "custom-task"), "b", "Never me must also apply to custom tasks before a chart is published");
assert.equal(creatorRulePreview.pinnedAssignments?.["preserved-rule"], "b", "editing one person's rules must retain other Sweetmates' rules");
assert.deepEqual(weeklyFor(creatorRulePreview), { a: 14, b: 4 }, "the first preview's weekly workload must reflect the permanent rules");
assert.deepEqual(creatorSeed, creatorSeedSnapshot, "editing rules must not change the shared payload before submission");
const creatorRuleSnapshot = structuredClone(creatorRulePreview);
assert.throws(() => build(creatorRuleTasks, { previous: withAssignmentRequest(creatorRulePreview, "custom-task", "b", "never") }), /No eligible member/, "a rule that excludes everyone must be rejected");
assert.deepEqual(creatorRulePreview, creatorRuleSnapshot, "a rejected exclusion must leave the last valid preview intact");
const creatorUnsent = reviewState({ ...reviewDraft, baseChartId: null, payload: creatorRulePreview }, null);
assert.deepEqual(choreChartReviewSubmission(creatorUnsent, true), { replace: true, approveSelf: false }, "permanent rule changes may only send for approval, leaving their creator Pending");
assert.deepEqual(choreChartReviewSubmission(creatorUnsent, false), { replace: true, approveSelf: true }, "ordinary chart approval must keep its existing creator-approval behavior");
assert.deepEqual(choreChartReviewSubmission(reviewState(), false), { replace: false, approveSelf: true }, "approving an unchanged shared chart must preserve its other votes");
assert.deepEqual(choreChartReviewSubmission(reviewState(), true), { replace: true, approveSelf: false }, "rule revisions must never self-approve, even when reviewing a shared version");
assert.equal(choreChartReviewSubmission({ kind: "stale", chartId: null }, true), null);
assert.equal(choreChartReviewSubmission({ kind: "approved", chartId: "new" }, false), null);
const sentRules = reviewState({ ...reviewDraft, payload: creatorRulePreview, submittedChartId: "new-rules", approvedChartId: null }, { ...reviewSharedChart, id: "new-rules", payload: creatorRulePreview }, true);
assert.deepEqual(sentRules, { kind: "pending", chartId: "new-rules" }, "a sent rule revision must remain visible after clearing the creator's local draft");
assert.equal(chartApprovalProgress(sentRules.chartId, approvalRoster, approvalRows).approvedCount, 0, "earlier approvals must not carry into the revised chart");
console.log("Creator permanent task preference tests passed");


const restartedReview = { ...reviewSharedChart, id: "restarted", status: "pending" as const, appliedAt: null };
const restartedState = reviewState({ ...reviewDraft, baseChartId: "restarted" }, restartedReview);
assert.deepEqual(restartedState, { kind: "pending", chartId: "restarted" }, "a restarted chart must be reviewable even when its saved payload is unchanged");
const restartedVotes = [
  ...approvalRows,
  { id: "restart-a", proposedChartId: "restarted", memberId: "a", approved: false, approvedAt: "" },
  { id: "restart-b", proposedChartId: "restarted", memberId: "b", approved: false, approvedAt: "" },
];
assert.deepEqual(chartApprovalProgress(restartedState.chartId, approvalRoster, restartedVotes).rows.map((row) => row.approved), [false, false], "old approvals must never make either member appear approved after restart");
assert.deepEqual(choreChartReviewSubmission(restartedState, false), { replace: false, approveSelf: true }, "both members must be allowed to approve the restarted review again");
assert.equal(reviewState({ ...reviewDraft, approvedChartId: "new" }, restartedReview).kind, "stale", "an already-open approved preview must not carry its saved vote into a restarted review");
console.log("Restarted chart approval state tests passed");


const newlyApprovedTasks = [
  task("upcoming-load", { frequency: "daily", timeOfDay: "night" }),
  task("upcoming-unload", { frequency: "daily", timeOfDay: "morning" }),
  task("upcoming-vacuum", { frequency: "weekly" }),
  task("upcoming-filter", { frequency: "monthly" }),
];
const newlyApprovedPayload = build(newlyApprovedTasks);
assert.equal(upcomingHouseholdChores([], householdId, now, timezone).length, 0, "an unsent or pending chart must not create Upcoming chores from its preview payload");
const approvedUpcomingAnchors = materialize(newlyApprovedPayload);
const approvedUpcomingSnapshot = structuredClone(approvedUpcomingAnchors);
const reconciledUpcoming = materializeRecurringOccurrences(approvedUpcomingAnchors, now, now.toISOString(), timezone, twoMembers.map((member) => member.id));
const visibleApprovedUpcoming = upcomingHouseholdChores(reconciledUpcoming, householdId, now, timezone);
assert.equal(visibleApprovedUpcoming.length, newlyApprovedTasks.length, "every task must be immediately visible in Upcoming after approved chores are saved and reconciled");
assert.deepEqual(visibleApprovedUpcoming.map((chore) => chore.scheduledDate), ["2026-07-28", "2026-07-28", "2026-08-03", "2026-08-27"], "Upcoming must keep the real daily, weekly, and monthly dates rather than bringing chores forward");
assert(visibleApprovedUpcoming.every((chore) => chore.assignedTo === owner(newlyApprovedPayload, chore.sourceKey!)), "Upcoming must show each chore's approved starting assignee");
assert.deepEqual(approvedUpcomingAnchors, approvedUpcomingSnapshot, "rendering Upcoming must not write or complete saved chores");
console.log("Approved chart immediate Upcoming integration tests passed");


const refreshedBlakeReview = parseChoreChartReviewSnapshot({
  householdId,
  chart: { id: "restart-current", household_id: householdId, created_by: "a", status: "pending", payload: sample, created_at: now.toISOString(), applied_at: null },
  approvals: [
    { id: "avery-fresh", household_id: householdId, proposed_chart_id: "restart-current", member_id: "a", approved: true },
    { id: "blake-fresh", household_id: householdId, proposed_chart_id: "restart-current", member_id: "b", approved: false },
    { id: "blake-old", household_id: householdId, proposed_chart_id: "old-applied", member_id: "b", approved: true },
    { id: "foreign", household_id: "other-home", proposed_chart_id: "restart-current", member_id: "b", approved: true },
  ],
}, householdId);
const blakeFreshState = reviewState({ ...reviewDraft, baseChartId: "restart-current" }, refreshedBlakeReview.chart);
assert.deepEqual(blakeFreshState, { kind: "pending", chartId: "restart-current" }, "a fresh preview must review the restarted chart, never the older approved version");
assert.deepEqual(chartApprovalProgress(blakeFreshState.chartId, approvalRoster, refreshedBlakeReview.approvals).rows.map((member) => member.approved), [true, false], "Blake must remain Pending while Avery's fresh approval is preserved");
assert.deepEqual(choreChartReviewSubmission(blakeFreshState, false), { replace: false, approveSelf: true }, "Blake must be able to approve the exact new review without resetting Avery's approval");
assert.equal(reviewState(reviewDraft, { ...reviewSharedChart, id: "another-generation", status: "approved" }).kind, "stale", "identical task payloads must not transfer approvals across chart generations");
assert.throws(() => parseChoreChartReviewSnapshot({ householdId: "other-home", chart: null, approvals: [] }, householdId), /another household/);
assert.deepEqual(parseChoreChartReviewSnapshot({ householdId, chart: null, approvals: [] }, householdId), { householdId, chart: null, approvals: [] });
console.log("Blake restarted review freshness tests passed");
