import type { Chore } from "../context/AppContext.ts";
import { choreToRow, rowToChore } from "./choreRow.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const chore: Chore = {
  id: "occurrence:home-a:series-1:2026-08-10",
  householdId: "home-a",
  title: "Take out trash",
  description: "Bins go to the curb",
  creatorId: "owner-1",
  assignedTo: "member-1",
  assignmentMode: "round-robin",
  roundRobinParticipantIds: ["member-1", "member-2"],
  roundRobinAllMembers: true,
  roundRobinCursor: 1,
  excludedParticipantIds: ["member-3"],
  dueDate: "2026-08-10T23:59:00.000Z",
  initialDueDate: "2026-08-03T23:59:00.000Z",
  nextDueDate: "2026-08-17T23:59:00.000Z",
  scheduledDate: "2026-08-10",
  initialScheduledDate: "2026-08-03",
  monthlyAnchorDay: 3,
  excludedOccurrenceDates: ["2026-08-05"],
  recurrenceEndsOn: "2026-12-31",
  completed: false,
  completedAt: undefined,
  completedByUserId: undefined,
  points: 15,
  category: "outdoor",
  recurring: "weekly",
  recurrenceSeriesId: "series-1",
  occurrenceIndex: 2,
  nextOccurrenceId: "occurrence:home-a:series-1:2026-08-17",
  sourceKey: "src-1",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-10T12:00:00.000Z",
};

const row = choreToRow(chore);
assert(row !== null, "a chore with a household id must produce a row");
assert(row!.assigned_to === "member-1", "assignedTo must carry through as-is when set");
assert(row!.household_id === "home-a", "household id must carry through");
assert(
  row!.round_robin_participant_ids.join(",") === "member-1,member-2",
  "round robin participants must carry through",
);

const roundTripped = rowToChore(row!);
assert(
  JSON.stringify(roundTripped) === JSON.stringify(chore),
  "a fully-populated chore must round-trip through the row shape without loss",
);

const unassigned: Chore = {
  ...chore,
  id: "one-off-1",
  assignedTo: "",
  assignmentMode: "unassigned",
  recurring: undefined,
  recurrenceSeriesId: undefined,
};
const unassignedRow = choreToRow(unassigned);
assert(
  unassignedRow!.assigned_to === null,
  "an empty-string assignedTo must become a real null, not an invalid empty uuid",
);
assert(
  rowToChore(unassignedRow!).assignedTo === "",
  "a null assigned_to must round-trip back to the empty-string convention the rest of the app expects",
);

const withoutHousehold: Chore = { ...chore, householdId: undefined };
assert(
  choreToRow(withoutHousehold) === null,
  "a chore with no household id must not be shadow-writable",
);

console.log("chore row mapping tests passed");
