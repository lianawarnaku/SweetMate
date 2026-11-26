import assert from "node:assert/strict";
import { ScheduleCompletionQueue } from "./scheduleCompletionQueue.ts";
import type { PersonalScheduleItem } from "./personalSchedule.ts";

const stamp = "2026-11-25T16:30:00.000Z";
const item: PersonalScheduleItem = { id: "event", user_id: "me", source: "google-event", resource_id: "calendar", provider_id: "event", title: "Private appointment",
  starts_at: null, ends_at: null, starts_on: "2026-11-25", ends_on: "2026-11-26", busy: false, link: null,
  app_completed_at: null, override_start: null, override_end: null, period_override: null };
function fixture() {
  const values = new Map<string, string | null>([["event", null], ["task", null]]);
  const requests: { id: string; completed: boolean; resolve: () => void; reject: (error: Error) => void }[] = [];
  const changes: { id: string; value: string | null }[] = [];
  let settled = 0;
  const queue = new ScheduleCompletionQueue({
    now: () => stamp,
    save: (id, completed) => new Promise<void>((resolve, reject) => requests.push({ id, completed, resolve, reject })),
    change: (id, value) => { values.set(id, value); changes.push({ id, value }); },
    settled: () => { settled++; },
  });
  return { queue, values, requests, changes, settled: () => settled };
}
async function tick() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
let f = fixture();
let saved = f.queue.update(item, true);
assert.equal(f.values.get("event"), stamp, "checking updates immediately before the network responds");
assert.equal(f.queue.update(item, true), saved, "duplicate completion intents share one background save");
assert.equal(f.requests.length, 1);
const refreshed = f.queue.overlay([{ ...item, title: "Updated by Google" }]);
assert.equal(refreshed[0].app_completed_at, stamp, "a stale refresh cannot uncheck a pending item");
assert.equal(refreshed[0].title, "Updated by Google", "optimism must preserve newly synced provider fields");
f.requests[0].resolve(); await saved;
assert(f.settled() > 0, "acknowledgements invalidate old reads");

f = fixture();
saved = f.queue.update(item, true);
f.queue.update(item, false);
assert.equal(f.values.get("event"), null, "undo also updates immediately while a save is pending");
f.requests[0].resolve(); await tick();
assert.equal(f.requests.length, 2);
assert.equal(f.requests[1].completed, false, "undo must be persisted after the older check");
assert.equal(f.values.get("event"), null, "an older success cannot visibly re-check an undone item");
f.requests[1].resolve(); await saved;

f = fixture();
saved = f.queue.update(item, true);
f.queue.update(item, false); f.queue.update(item, true);
f.requests[0].resolve(); await saved;
assert.equal(f.requests.length, 1, "quick check/undo/check coalesces to the already-saved final state");
assert.equal(f.values.get("event"), stamp);

f = fixture();
const eventSave = f.queue.update(item, true).catch(error => error);
const taskSave = f.queue.update({ ...item, id: "task", source: "google-task" }, true);
assert.equal(f.requests.length, 2, "other rows can save independently without waiting for this item");
f.requests[0].reject(new Error("Offline"));
f.requests[1].resolve();
assert.equal((await eventSave).message, "Offline"); await taskSave;
assert.equal(f.values.get("event"), null, "a failed save restores only its own acknowledged value");
assert.equal(f.values.get("task"), stamp, "another row's success must survive the failure");

f = fixture();
const failedUndo = f.queue.update(item, true).catch(error => error);
f.queue.update(item, false);
f.requests[0].resolve(); await tick();
f.requests[1].reject(new Error("Undo failed"));
assert.equal((await failedUndo).message, "Undo failed");
assert.equal(f.values.get("event"), stamp, "a failed undo restores the successful check, not the original unchecked state");

f = fixture();
saved = f.queue.update(item, true); f.queue.update(item, false);
f.requests[0].reject(new Error("Old request failed")); await saved;
assert.equal(f.values.get("event"), null, "a superseded failure cannot undo the newer choice");
assert.equal(f.requests.length, 1, "a queued choice matching the saved state needs no extra request");

f = fixture();
const cancelled = f.queue.update(item, true).catch(error => error);
f.queue.update(item, false);
f.queue.dispose();
assert.equal((await cancelled).name, "AbortError");
const changes = f.changes.length;
f.requests[0].resolve(); await tick();
assert.equal(f.changes.length, changes, "late results cannot change another account's state");
assert.equal(f.requests.length, 1, "changing accounts cancels unsent old-account writes");
console.log("Instant schedule completion tests passed: immediate checks/undo, coalescing, independent rows, stale refreshes, rollback and account isolation.");
