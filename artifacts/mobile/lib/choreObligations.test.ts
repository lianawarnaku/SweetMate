import { createChorePolicyFetch } from "./chorePolicyFetch.ts";
import { strict as assert } from "node:assert";
import type { Chore } from "../context/AppContext";
import {
  deleteRecurringChore,
  materializeRecurringOccurrences as reconcile,
} from "./choreOccurrences.ts";
import { choreDefinitionId, definitionFromChore } from "./choreIdentity.ts";
import { activeChores } from "./choreLifecycle.ts";
import { resolveChorePermissions } from "./chorePermissions.ts";
import { choreToRow, rowToChore } from "./choreRow.ts";
import { projectChoreChartSchedule } from "./choreChartSchedule.ts";
const roster = ["x", "y", "z"];
const now = (date: string) => new Date(`${date}T15:00:00Z`);
const base: Chore = {
  id: "root",
  householdId: "sweet",
  title: "Kitchen trash",
  assignedTo: "x",
  assignmentMode: "round-robin",
  roundRobinParticipantIds: roster,
  roundRobinAllMembers: true,
  dueDate: "2026-11-01T17:00:00Z",
  scheduledDate: "2026-11-01",
  initialDueDate: "2026-11-01T17:00:00Z",
  initialScheduledDate: "2026-11-01",
  recurring: "weekly",
  recurrenceSeriesId: "root",
  completed: false,
  points: 10,
  category: "kitchen",
};
const run = (rows: Chore[], date: string, members = roster) =>
  reconcile(
    rows,
    now(date),
    now(date).toISOString(),
    "America/New_York",
    members,
  );
const open = (rows: Chore[]) =>
  rows.filter((row) => !row.completed && !row.skippedAt);
let rows = run([base], "2026-11-15");
assert.equal(open(rows).length, 1);
assert.equal(open(rows)[0].assignedTo, "x");
assert.deepEqual(
  rows.filter((row) => row.skippedAt).map((row) => row.assignedTo),
  ["y", "z"],
);
assert.equal(
  activeChores(rows, now("2026-11-15")).length,
  1,
  "oldest obligation must not disappear into archive",
);
assert.equal(
  run(rows, "2026-11-15"),
  rows,
  "reconciliation must settle without rerender loops",
);
rows = run(
  rows.map((row) =>
    row.id === base.id
      ? {
          ...row,
          completed: true,
          completedAt: now("2026-11-16").toISOString(),
          completedByUserId: "y",
        }
      : row,
  ),
  "2026-11-16",
);
assert.equal(
  open(rows).length,
  0,
  "finishing the oldest obligation must finish today's work",
);
assert.equal(
  rows.find((row) => row.scheduledDate === "2026-11-08")?.skippedReason,
  "outstanding",
);
assert.equal(
  activeChores(rows, now("2026-11-16")).filter((row) => row.completed).length,
  1,
);
assert.equal(run(rows, "2026-11-16"), rows);
rows = run(rows, "2026-11-22");
assert.equal(open(rows).length, 1);
assert.equal(
  open(rows)[0].assignedTo,
  "x",
  "rotation consumes skipped Y and Z turns permanently",
);
assert.equal(open(rows)[0].scheduledDate, "2026-11-22");
const helped = rows.find((row) => row.id === base.id)!;
assert.equal(helped.completedByUserId, "y");
assert.equal(
  helped.assignedTo,
  "x",
  "helper records completion without stealing obligation ownership",
);
assert(
  resolveChorePermissions({
    currentUserId: "y",
    isActiveMember: true,
    isOwner: false,
    chore: base,
  }).canComplete,
);
assert(
  !resolveChorePermissions({
    currentUserId: "y",
    isActiveMember: true,
    isOwner: false,
    chore: rows.find((row) => row.skippedAt)!,
  }).canComplete,
);
const leave = run([base], "2026-11-15", ["y", "z"]);
assert.equal(open(leave).length, 1);
assert.equal(open(leave)[0].assignedTo, "");
assert.equal(open(leave)[0].assignmentMode, "unassigned");
const duplicate: Chore = {
  ...base,
  id: "duplicate",
  assignedTo: "y",
  scheduledDate: "2026-11-08",
  dueDate: "2026-11-08T17:00:00Z",
};
const done: Chore = {
  ...base,
  id: "completed-history",
  completed: true,
  scheduledDate: "2026-10-25",
  dueDate: "2026-10-25T17:00:00Z",
  completedAt: "2026-10-25T18:00:00Z",
  points: 25,
};
const migrated = run([duplicate, done, base], "2026-11-15");
assert.equal(open(migrated)[0].id, "root");
assert(migrated.find((row) => row.id === "duplicate")?.skippedAt);
assert.equal(migrated.find((row) => row.id === done.id)?.points, 25);
assert.equal(
  migrated.find((row) => row.id === done.id)?.completedAt,
  done.completedAt,
);
assert.notEqual(
  choreDefinitionId(base),
  choreDefinitionId({ ...base, id: "bedroom", recurrenceSeriesId: "bedroom" }),
  "matching titles must not implicitly link chores",
);
const separate = run(
  [base, { ...base, id: "bathroom", recurrenceSeriesId: "bathroom" }],
  "2026-11-15",
);
assert.equal(open(separate).length, 2);
const anotherSweet = run(
  [base, { ...base, id: "other-sweet", householdId: "other" }],
  "2026-11-15",
);
assert.equal(open(anotherSweet).length, 2);
const identity = choreDefinitionId(base);
const monthly = {
  ...base,
  id: "monthly",
  recurrenceSeriesId: "monthly",
  recurring: "monthly" as const,
  assignedTo: "y",
  choreDefinitionId: identity,
  createdAt: "2026-11-10T00:00:00Z",
};
const linked = run([base, monthly], "2026-11-15");
assert.equal(open(linked)[0].assignedTo, "x");
assert.equal(open(linked).length, 1);
assert(
  linked.every((row) => row.choreDefinition?.recurring === "monthly"),
  "a shared identity has one canonical cadence",
);
const canonical = {
  ...definitionFromChore(base),
  recurring: "monthly" as const,
  assignmentMode: "specific-person" as const,
  assignedTo: "z",
  updatedAt: "2026-11-16T00:00:00Z",
};
const edited = run(
  migrated.map((row) => ({ ...row, choreDefinition: canonical })),
  "2026-11-16",
);
assert.equal(open(edited)[0].assignedTo, "x");
assert.equal(open(edited)[0].dueDate, base.dueDate);
const afterEdit = run(
  edited.map((row) =>
    row.id === base.id
      ? {
          ...row,
          completed: true,
          completedAt: now("2026-11-16").toISOString(),
        }
      : row,
  ),
  "2026-12-01",
);
assert.equal(open(afterEdit).length, 1);
assert.equal(open(afterEdit)[0].assignedTo, "z");
assert.equal(open(afterEdit)[0].scheduledDate, "2026-12-01");
const future = {
  ...base,
  id: "future",
  scheduledDate: "2026-11-08",
  dueDate: "2026-11-08T17:00:00Z",
};
let futureRows = run([base, future], "2026-11-02");
assert.equal(open(futureRows).length, 1);
futureRows = run(
  futureRows.map((row) =>
    row.id === base.id
      ? {
          ...row,
          completed: true,
          completedAt: now("2026-11-03").toISOString(),
        }
      : row,
  ),
  "2026-11-08",
);
assert.equal(open(futureRows).length, 1);
assert.equal(
  open(futureRows)[0].scheduledDate,
  "2026-11-08",
  "old future placeholder must become eligible on its date if X completed in time",
);
const undone = run(
  rows.map((row) =>
    row.id === base.id
      ? { ...row, completed: false, completedAt: undefined }
      : row,
  ),
  "2026-11-22",
);
assert.equal(open(undone).length, 1);
assert.equal(
  open(undone)[0].id,
  base.id,
  "undo restores earliest owner without two obligations",
);
assert.equal(
  projectChoreChartSchedule(
    run([base], "2026-11-15"),
    roster,
    "2026-11-01",
    "2026-12-01",
    "2026-11-15",
  ).length,
  1,
  "calendar must not assign Y a hypothetical turn while X owes the chore",
);
for (const row of migrated) {
  const stored = choreToRow(row)!;
  const restored = rowToChore(stored);
  assert.equal(restored.choreDefinitionId, row.choreDefinitionId);
  assert.deepEqual(restored.choreDefinition, row.choreDefinition);
  assert.equal(restored.skippedAt, row.skippedAt);
}
console.log("single chore obligation regressions passed");

const finishedEdit = edited.map((row) =>
  row.id === base.id
    ? { ...row, completed: true, completedAt: now("2026-11-16").toISOString() }
    : row,
);
const futurePreview = projectChoreChartSchedule(
  finishedEdit,
  roster,
  "2026-11-16",
  "2027-01-01",
  "2026-11-16",
).filter((row) => row.projected);
assert.deepEqual(
  futurePreview.map((row) => [row.scheduledDate, row.assignedTo]),
  [
    ["2026-12-01", "z"],
    ["2027-01-01", "z"],
  ],
);

const stopped = deleteRecurringChore(
  linked,
  open(linked)[0],
  "series",
  now("2026-11-16").toISOString(),
);
assert.equal(
  open(run(stopped, "2027-01-01")).length,
  0,
  "deleting the shared chore must stop all of its legacy schedules",
);

const missingCanonical = edited.map((row) => ({
  ...row,
  choreDefinition: { ...row.choreDefinition!, seriesId: "future-only" },
}));
const stopMissing = deleteRecurringChore(
  missingCanonical,
  open(missingCanonical)[0],
  "series",
  now("2026-11-16").toISOString(),
);
assert.equal(
  open(run(stopMissing, "2027-01-01")).length,
  0,
  "an edited future schedule must stop even when its first occurrence has not been stored yet",
);

const calls: Array<{input: RequestInfo | URL; init?: RequestInit}> = [];
const stubFetch: typeof fetch = async (input, init) => { calls.push({input,init}); return new Response("ok"); };
const compatibleFetch=createChorePolicyFetch("https://example.supabase.co",stubFetch);
await compatibleFetch("https://example.supabase.co/rest/v1/chores",{method:"POST",headers:{authorization:"Bearer test-only"},body:"[]"});
assert.equal(new Headers(calls[0].init?.headers).get("x-sweetmate-chore-policy"),"single-obligation-v1");
assert.equal(new Headers(calls[0].init?.headers).get("authorization"),"Bearer test-only");
await compatibleFetch("https://example.supabase.co/functions/v1/calendar",{headers:{authorization:"Bearer test-only"}});
assert.equal(new Headers(calls[1].init?.headers).has("x-sweetmate-chore-policy"),false,"Edge Functions must keep their existing browser CORS contract");
console.log("chore client compatibility transport tests passed");
