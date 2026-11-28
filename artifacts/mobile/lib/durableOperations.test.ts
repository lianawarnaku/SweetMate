import assert from "node:assert/strict";
import {
  DurableOperations,
  operationStorageKey,
  type OperationRequest,
  type PendingOperation,
} from "./durableOperations.ts";
const request = (value = true): OperationRequest => ({
  name: "shopping_items",
  rpc: false,
  method: "POST",
  body: { id: "milk", completed: value },
  query: [],
  prefer: "resolution=merge-duplicates",
  accept: "",
});
const values = new Map<string, string>();
let offline = true,
  storageFails = false,
  removalFails = false,
  sends = 0,
  sequence = 0,
  serverValue = false,
  gates: (() => void)[] = [];
const receipts = new Map<string, unknown>(),
  sent: PendingOperation[] = [];
const storage = {
  getItem: async (key: string) => values.get(key) ?? null,
  setItem: async (key: string, raw: string) => {
    if (
      storageFails ||
      (removalFails && JSON.parse(raw).operations.length === 0)
    )
      throw Error("Device full");
    values.set(key, raw);
  },
};
function fixture(
  userId = "avery",
  behavior?: (op: PendingOperation) => Promise<any>,
) {
  return new DurableOperations({
    userId,
    storage,
    makeId: () => `operation-${++sequence}`,
    changed: () => {},
    send: async (op) => {
      sends++;
      sent.push(op);
      if (behavior) return behavior(op);
      if (offline) throw Error("Offline");
      if (!receipts.has(op.id)) {
        serverValue = (op.request.body as any).completed;
        receipts.set(op.id, serverValue);
      }
      return { status: 200, data: receipts.get(op.id) };
    },
  });
}
function reset() {
  values.clear();
  receipts.clear();
  sent.length = 0;
  offline = true;
  storageFails = false;
  removalFails = false;
  sends = 0;
  serverValue = false;
}
// Failed save -> terminate all memory -> new process model restores the exact operation ID.
reset();
let a = fixture();
await assert.rejects(a.submit(request(), "avery:home"));
const durableId = a.pending[0].id;
a.dispose();
offline = false;
const b = fixture();
await b.initialize();
assert.equal(serverValue, true);
assert.equal(sent.at(-1)?.id, durableId);
assert.equal(b.pending.length, 0);
// A server commit whose response was lost is replayed using the same receipt.
reset();
let commits = 0;
a = fixture("avery", async (op) => {
  if (!receipts.has(op.id)) {
    commits++;
    receipts.set(op.id, true);
  }
  throw Error("ACK lost");
});
await assert.rejects(a.submit(request(), "avery:home"));
a.dispose();
offline = false;
await fixture().initialize();
assert.equal(commits, 1);
assert.equal(receipts.size, 1);
// Every tap reaches disk while an earlier network call is stalled; check/undo/check remains ordered.
reset();
let release!: () => void;
const gate = new Promise<void>((resolve) => (release = resolve));
a = fixture("avery", async (op) => {
  await gate;
  throw Error("Offline");
});
const first = a.submit(request(true), "avery:home").catch(() => {});
await new Promise((resolve) => setTimeout(resolve, 0));
const second = a.submit(request(false), "avery:home").catch(() => {});
const third = a.submit(request(true), "avery:home").catch(() => {});
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(
  JSON.parse(values.get(operationStorageKey("avery"))!).operations.map(
    (op: any) => op.request.body.completed,
  ),
  [true, false, true],
);
a.dispose();
release();
await Promise.all([first, second, third]);
offline = false;
await fixture().initialize();
assert.equal(serverValue, true);
assert.equal(receipts.size, 3);
// Duplicate repeated Save coalesces only consecutive identical pending requests.
reset();
a = fixture();
await assert.rejects(a.submit(request(), "avery:home"));
await assert.rejects(a.submit(request(), "avery:home"));
assert.equal(a.pending.length, 1);
// Local storage refusal never sends an unjournaled operation.
reset();
storageFails = true;
a = fixture();
await assert.rejects(a.submit(request(), "avery:home"));
assert.equal(sends, 0);
// Local acknowledgement/removal failure retains the request for safe receipt replay.
reset();
offline = false;
removalFails = true;
a = fixture();
await assert.rejects(a.submit(request(), "avery:home"));
assert.equal(receipts.size, 1);
a.dispose();
removalFails = false;
await fixture().initialize();
assert.equal(receipts.size, 1);
assert.equal(serverValue, true);
// Permanent rejection stays reviewable without blocking unrelated commands.
reset();
a = fixture("avery", async (op) => ({
  status: (op.request.body as any).completed ? 403 : 200,
  data: null,
}));
assert.equal((await a.submit(request(true), "avery:home")).status, 403);
await a.submit(request(false), "avery:home");
assert.equal(a.pending.length, 0);
// Account separation and malformed-storage protection.
reset();
a = fixture();
await assert.rejects(a.submit(request(), "avery:home"));
a.dispose();
offline = false;
await fixture("blake").initialize();
assert.equal(sends, 1);
assert.equal(serverValue, false);
values.set(operationStorageKey("broken"), "not-json");
const broken = fixture("broken");
await assert.rejects(broken.initialize());
assert.equal(values.get(operationStorageKey("broken")), "not-json");
console.log(
  "Durable operation restart, lost ACK, ordering, storage failure, receipt reuse, rejection and account isolation tests passed",
);
