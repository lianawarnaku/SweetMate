import type { Chore } from "../context/AppContext.ts";
import { choreToRow } from "./choreRow.ts";
import { applyChoreRowEvent, choreParity, planChoreSync } from "./choreSync.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const base: Chore = {
  id: "series-1:0", householdId: "home-1", title: "Dishes", assignedTo: "user-1",
  assignmentMode: "specific-person", dueDate: "2026-08-27T23:59:00.000Z",
  scheduledDate: "2026-08-27", completed: false, points: 10, category: "kitchen",
  recurring: "daily", recurrenceSeriesId: "series-1", occurrenceIndex: 0,
  createdAt: "2026-08-27T12:00:00.000Z", updatedAt: "2026-08-27T12:00:00.000Z",
};
const future = { ...base, id: "series-1:1", scheduledDate: "2026-08-28", occurrenceIndex: 1 };
const unrelated = { ...base, id: "one-off", recurring: undefined, recurrenceSeriesId: undefined };

const occurrence = planChoreSync([future, unrelated], new Set([base.id, future.id, unrelated.id]));
assert(occurrence.deleteIds.join() === base.id, "occurrence deletion must remove exactly one normalized row");
const futureScope = planChoreSync([unrelated], new Set([base.id, future.id, unrelated.id]));
assert(futureScope.deleteIds.join() === [base.id, future.id].sort().join(), "future deletion must remove all selected series rows");
const seriesScope = planChoreSync([unrelated], new Set([base.id, future.id, unrelated.id]));
assert(seriesScope.deleteIds.length === 2, "series deletion must not leave orphan rows");

const baseRow = choreToRow(base)!;
assert(
  planChoreSync([base], new Map([[base.id, baseRow]])).upserts.length === 0,
  "unchanged rows must not be re-sent and overwrite an unrelated remote update",
);
const inserted = applyChoreRowEvent([], "INSERT", baseRow);
assert(inserted.length === 1 && inserted[0].id === base.id, "Realtime insert must hydrate a chore");
const updatedRow = { ...baseRow, title: "Kitchen dishes", updated_at: "2026-08-27T13:00:00.000Z" };
const updated = applyChoreRowEvent(inserted, "UPDATE", updatedRow);
assert(updated[0].title === "Kitchen dishes", "Realtime update must replace the row");
assert(applyChoreRowEvent(updated, "DELETE", updatedRow).length === 0, "Realtime delete must remove the row");

assert(choreParity([base], [baseRow]).missing.length === 0, "matching blob and rows must pass parity");
assert(choreParity([base], []).missing[0] === base.id, "parity must report missing rows");
assert(choreParity([], [baseRow]).extra[0] === base.id, "parity must report orphan rows");
assert(choreParity([base], [updatedRow]).mismatched[0] === base.id, "parity must report field mismatches");

console.log("chore normalized sync tests passed");
