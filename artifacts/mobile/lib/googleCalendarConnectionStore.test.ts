import assert from "node:assert/strict";
import { createCalendarConnectionStore } from "./googleCalendarConnectionStore.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Settings and the home link must see the same verified result, even when a
// status request started before Google returns resolves after the save.
const slow = deferred<boolean>();
let checks = 0, opens = 0, updates = 0;
const store = createCalendarConnectionStore({
  check: async () => ++checks === 1 ? slow.promise : true,
  connect: async () => { opens++; },
  disconnect: async () => {},
});
const snapshot = store.getSnapshot("avery");
assert.equal(snapshot, store.getSnapshot("avery"));
store.subscribe("avery", () => { updates++; });
const checking = store.refresh("avery");
await Promise.resolve();
const connected = store.connect("avery");
assert.equal(store.connect("avery"), connected, "two buttons must not open competing Google sessions");
await connected;
assert.equal(opens, 1);
assert.equal(store.getSnapshot("avery").connected, true);
slow.resolve(false); await checking;
assert.equal(store.getSnapshot("avery").connected, true, "late pre-connection response must not reset Settings");
assert.equal(store.getSnapshot("avery").busy, false);
assert(updates > 1);
assert.equal(store.getSnapshot("blake").connected, null, "another person's connection status stays separate");

// A server save that did not persist must not be presented as connected.
const unsaved = createCalendarConnectionStore({ check: async () => false, connect: async () => {}, disconnect: async () => {} });
await assert.rejects(unsaved.connect("avery"), /not saved/);
assert.equal(unsaved.getSnapshot("avery").connected, null);
assert.equal(unsaved.getSnapshot("avery").busy, false);
assert.match(unsaved.getSnapshot("avery").error!, /not saved/);

// Failure remains visible after a screen remount and a retry is possible.
let online = false;
const retry = createCalendarConnectionStore({
  check: async () => { if (!online) throw new Error("Network unavailable"); return true; },
  connect: async () => {}, disconnect: async () => {},
});
await assert.rejects(retry.refresh("avery"), /Network/);
assert.equal(retry.getSnapshot("avery").connected, null, "network errors must not invent a disconnected result");
assert.equal(retry.getSnapshot("avery").checking, false);
online = true; await retry.connect("avery");
assert.equal(retry.getSnapshot("avery").connected, true);
assert.equal(retry.getSnapshot("avery").error, null);

// Returning to Settings/foreground checks server state again; disconnect also
// updates all subscribers rather than one component's local boolean.
let saved = true;
const shared = createCalendarConnectionStore({ check: async () => saved, connect: async () => { saved = true; }, disconnect: async () => { saved = false; } });
await shared.refresh("avery");
await shared.disconnect("avery");
assert.equal(shared.getSnapshot("avery").connected, false);
saved = true; await shared.refresh("avery");
assert.equal(shared.getSnapshot("avery").connected, true);

// A still-open OAuth browser cannot be started again for a different account.
const browser = deferred<void>();
const owners = createCalendarConnectionStore({ check: async () => true, connect: async () => browser.promise, disconnect: async () => {} });
const first = owners.connect("avery");
await assert.rejects(owners.connect("blake"), /Finish the current Google connection/);
assert.equal(owners.getSnapshot("blake").busy, false);
browser.resolve(); await first;
console.log("Shared Google Calendar status, OAuth deduplication, stale-result protection, account isolation, server persistence and retry tests passed.");
