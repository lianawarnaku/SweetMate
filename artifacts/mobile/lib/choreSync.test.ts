import type { Chore } from "../context/AppContext.ts";
import { choreToRow } from "./choreRow.ts";
import { applyChoreRowEvent, choreParity, mergeChoreSnapshot, planChoreSync } from "./choreSync.ts";

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

// PostgREST rows and JSONB definitions do not preserve client key ordering.
// Replaying unchanged data from two devices must never restart persistence.
function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reverseObjectKeys(entry)]));
  return value;
}
const definedChore: Chore = { ...base, choreDefinitionId: "source:dishes", roundRobinParticipantIds: ["user-1", "user-2"],
  choreDefinition: { id: "source:dishes", seriesId: "series-1", title: base.title, category: base.category,
    points: base.points, assignedTo: base.assignedTo, anchorDate: "2026-08-27", anchorDueDate: base.dueDate,
    monthlyAnchorDay: 27, updatedAt: base.updatedAt! } };
const definedRow = choreToRow(definedChore)!;
const databaseRow = reverseObjectKeys(definedRow) as typeof definedRow;
assert(JSON.stringify(databaseRow) !== JSON.stringify(definedRow), "the fixture must reproduce database key ordering");
const remoteRows = new Map([[definedRow.id, databaseRow]]);
assert(planChoreSync([definedChore], remoteRows).upserts.length === 0, "database key ordering must not queue writes of unchanged chores");
assert(choreParity([definedChore], [databaseRow]).mismatched.length === 0, "parity must compare actual values, including JSONB definitions");
let firstDevice = [definedChore];
let secondDevice = applyChoreRowEvent([], "INSERT", databaseRow);
for (let event = 0; event < 50; event++) {
  const beforeFirst = firstDevice, beforeSecond = secondDevice;
  firstDevice = applyChoreRowEvent(firstDevice, "UPDATE", databaseRow);
  secondDevice = applyChoreRowEvent(secondDevice, "UPDATE", definedRow);
  assert(firstDevice === beforeFirst && secondDevice === beforeSecond, "an unchanged echo must retain both devices' snapshots");
  assert(planChoreSync(firstDevice, remoteRows).upserts.length === 0 && planChoreSync(secondDevice, remoteRows).upserts.length === 0, "two-device echoes must settle without generating more writes");
}
const postgresTimestampRow = { ...databaseRow, due_date: definedRow.due_date.replace(".000Z", "+00:00"),
  created_at: definedRow.created_at.replace(".000Z", "+00:00"), updated_at: definedRow.updated_at.replace(".000Z", "+00:00") };
assert(planChoreSync([definedChore], new Map([[definedChore.id, postgresTimestampRow]])).upserts.length === 0, "equivalent database timestamp formatting must not cause writes");
assert(applyChoreRowEvent(firstDevice, "UPDATE", postgresTimestampRow) === firstDevice, "equivalent UTC timestamps must not restart synchronization");
assert(planChoreSync([{ ...definedChore, title: "Actually edited" }], remoteRows).upserts.length === 1, "a real title edit must still persist");
assert(planChoreSync([{ ...definedChore, roundRobinParticipantIds: ["user-2", "user-1"] }], remoteRows).upserts.length === 1, "rotation participant order is meaningful and must persist");
assert(planChoreSync([{ ...definedChore, choreDefinition: { ...definedChore.choreDefinition!, title: "New definition" } }], remoteRows).upserts.length === 1, "a real nested definition edit must still persist");
const sameInstantEdit = { ...postgresTimestampRow, title: "Edited on another device" };
assert(applyChoreRowEvent(firstDevice, "UPDATE", sameInstantEdit)[0].title === sameInstantEdit.title, "equivalent timestamp spellings must not discard real remote edits");
const older = { ...sameInstantEdit, updated_at: "2026-08-26T12:00:00Z", title: "Old version" };
assert(applyChoreRowEvent(firstDevice, "UPDATE", older) === firstDevice, "older events must retain the newer local snapshot");
assert(applyChoreRowEvent(firstDevice, "DELETE", { ...databaseRow, id: "already-gone" }) === firstDevice, "replayed deletes must not trigger another save");
console.log("Chore database round-trip and two-device sync feedback regression tests passed");

// Chart applied on another device; recover missed rows while keeping local work.
const pendingEdit = { ...base, title: "Edited while loading", updatedAt: "2026-08-27T14:00:00.000Z" };
const freshChart = { ...base, id: "new-chart-anchor", title: "New chart task" };
const baseline = new Map([base, unrelated].map(chore => [chore.id, choreToRow(chore)!]));
const recovered = mergeChoreSnapshot([pendingEdit], baseline, [baseRow, choreToRow(unrelated)!, choreToRow(freshChart)!]);
assert(recovered.some(chore => chore.id === freshChart.id), "an already-applied chart must recover its missed chore rows");
assert(recovered.find(chore => chore.id === base.id)?.title === pendingEdit.title, "refresh must preserve edits made during a read");
assert(!recovered.some(chore => chore.id === unrelated.id), "refresh must preserve a pending local deletion");
assert(mergeChoreSnapshot([base], new Map([[base.id, baseRow]]), [choreToRow(freshChart)!]).length === 1, "retired chart rows must leave the local snapshot");
console.log("Missed chart event recovery preserves local edits, deletions and retired rows");
