import { parseRandomTasksSnapshot, randomTaskClaimTime } from "./randomTasks.ts";
import { rowToChore, choreToRow, type ChoreRow } from "./choreRow.ts";
import { applyChoreRowEvent, planChoreSync } from "./choreSync.ts";

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const now = Date.parse("2026-11-24T15:00:00Z");
const row = { id: "task", household_id: "home", title: "Take out boxes", mode: "up-for-grabs", created_by: "avery",
  created_at: new Date(now).toISOString(), claim_deadline: new Date(now + 86_400_000).toISOString(),
  assigned_at: null, assignment_kind: null, assigned_to: null, chore_id: null, completed: false, due_at: null };
const parse = (tasks: unknown[], chores: unknown[] = []) => parseRandomTasksSnapshot({ householdId: "home", serverNow: new Date(now).toISOString(), tasks, chores }, "home");
const open = parse([row]).tasks[0];
assert(open.householdId === "home" && open.assignedAt === null && open.assignedTo === null, "open tasks must remain shared and unassigned");
assert(randomTaskClaimTime(open, now) === "24h left to claim", "a new task must have a full 24-hour claim window");
assert(randomTaskClaimTime(open, now + 86_340_000) === "1m left to claim", "last-minute countdown must remain claimable until cutoff");
assert(randomTaskClaimTime(open, now + 86_400_000).startsWith("Claim window closed"), "claim eligibility must end at the exact deadline");
assert(randomTaskClaimTime(open, now + 86_400_001).startsWith("Claim window closed"), "expired tasks must never appear available");
for (const data of [{ householdId: "elsewhere", serverNow: new Date(now).toISOString(), tasks: [row], chores: [] },
  { householdId: "home", serverNow: "invalid", tasks: [row], chores: [] },
  { householdId: "home", serverNow: new Date(now).toISOString(), tasks: [{ ...row, household_id: "elsewhere" }], chores: [] }]) {
  let denied = false;
  try { parseRandomTasksSnapshot(data, "home"); } catch { denied = true; }
  assert(denied, "malformed or cross-household snapshots must fail closed");
}
const chore: ChoreRow = {
  id: "random-task:task", household_id: "home", title: row.title, creator_id: "avery", description: null,
  assigned_to: "blake", assignment_mode: "specific-person", assignment_locked: true,
  round_robin_participant_ids: [], round_robin_all_members: false, round_robin_cursor: 0, excluded_participant_ids: [],
  due_date: "2026-11-25T16:00:00Z", initial_due_date: "2026-11-25T16:00:00Z", next_due_date: null,
  scheduled_date: "2026-11-25", initial_scheduled_date: "2026-11-25", monthly_anchor_day: null,
  excluded_occurrence_dates: [], materialization_starts_on: null, recurrence_ends_on: null,
  completed: false, completed_at: null, completed_by_user_id: null, points: 0, category: "other", recurring: null,
  recurrence_series_id: null, occurrence_index: null, next_occurrence_id: null, source_key: "random-task:task", time_of_day: "any",
  created_at: "2026-11-24T16:00:00Z", updated_at: "2026-11-24T16:00:00Z",
};
const assigned = parse([{ ...row, assigned_at: chore.created_at, assignment_kind: "claimed", assigned_to: "blake", chore_id: chore.id, due_at: chore.due_date }],
  [chore, { ...chore, id: "unrelated" }, { ...chore, household_id: "elsewhere" }]);
assert(assigned.chores.length === 1 && assigned.tasks[0].assignedTo === "blake", "only the matching household chore may enter shared state");
const saved = rowToChore(assigned.chores[0]);
assert(saved.assignmentLocked && !saved.recurring && saved.assignedTo === "blake", "assigned random tasks must be ordinary locked one-time chores");
const latest = applyChoreRowEvent([], "INSERT", chore);
const persisted = new Map([[chore.id, choreToRow(latest[0])!]]);
const sync = planChoreSync(latest, persisted);
assert(sync.deleteIds.length === 0 && sync.upserts.length === 0, "a server-assigned chore must not be deleted or redrawn by local synchronization");
const completed = parse([{ ...row, chore_id: chore.id, assigned_at: chore.created_at, completed: true }], [{ ...chore, completed: true }]);
assert(completed.tasks[0].completed, "completed random tasks must retain completion in the shared section");
console.log("Random task scoping, deadline, and chore integration tests passed");
