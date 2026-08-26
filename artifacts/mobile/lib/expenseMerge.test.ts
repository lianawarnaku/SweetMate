import { mergeByUpdatedAt } from "./expenseMerge.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// Regression for the confirmed bug: settling an expense locally (newer
// updatedAt) must survive a remote snapshot that still carries the
// unsettled, older copy — the exact race a blind `setExpenses(next.expenses)`
// used to lose.
const settledLocally = [{ id: "e1", settled: true, updatedAt: "2026-08-03T10:00:01.000Z" }];
const staleRemoteSnapshot = [{ id: "e1", settled: false, updatedAt: "2026-08-03T10:00:00.000Z" }];
const afterRace = mergeByUpdatedAt(settledLocally, staleRemoteSnapshot);
assert(
  afterRace.length === 1 && afterRace[0].settled === true,
  "a newer local settlement must win over an older remote snapshot",
);

// A genuinely newer remote edit (e.g. another device edited it after this
// device's last known state) must still be adopted.
const staleLocal = [{ id: "e1", settled: false, updatedAt: "2026-08-03T10:00:00.000Z" }];
const newerRemote = [{ id: "e1", settled: true, updatedAt: "2026-08-03T10:00:05.000Z" }];
const afterNewerRemote = mergeByUpdatedAt(staleLocal, newerRemote);
assert(
  afterNewerRemote[0].settled === true,
  "a genuinely newer remote edit must be adopted over stale local state",
);

// A record deleted on another device (absent from the remote snapshot) must
// be dropped locally too — this merge does not resurrect missing records.
const localWithDeleted = [
  { id: "e1", updatedAt: "2026-08-03T10:00:00.000Z" },
  { id: "e2", updatedAt: "2026-08-03T10:00:00.000Z" },
];
const remoteAfterDelete = [{ id: "e1", updatedAt: "2026-08-03T10:00:00.000Z" }];
const afterDelete = mergeByUpdatedAt(localWithDeleted, remoteAfterDelete);
assert(
  afterDelete.length === 1 && afterDelete[0].id === "e1",
  "a record removed remotely must be dropped locally, propagating deletion",
);

console.log("expense merge tests passed");
