import assert from "node:assert/strict";
import { ExpensePendingError, ExpenseSync, type ExpenseOperation, type ExpenseMutationResult, type ExpenseSyncState } from "./expenseSync.ts";
import type { ExpenseRow } from "./expenseRow.ts";

const row = (id: string, version = 1, paidBack: Record<string, boolean> = {}): ExpenseRow => ({
  id, household_id: "home", paid_by: "payer", creator_id: "creator", amount_cents: 600,
  expense_date: "2026-11-08", settled: false, version,
  entry: { id, title: "Expense", amount: 6, amountCents: 600, paidBy: "payer", sharedWith: ["a", "b"], splits: { a: 3, b: 3 }, date: "2026-11-08", category: "other", settled: false, paidBack },
  created_at: "2026-11-08T12:00:00Z", updated_at: `2026-11-08T12:00:0${version}Z`,
});
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture(initial = [row("one")], store = new Map<string, string>()) {
  let server = initial;
  let counter = 0;
  let displayed: ExpenseRow[] = [];
  let state!: ExpenseSyncState;
  const calls: ExpenseOperation[] = [];
  const receipts = new Map<string, ExpenseMutationResult>();
  let fail: unknown;
  let holdFetch: Promise<ExpenseRow[]> | undefined;
  let holdMutation: Promise<void> | undefined;
  let storageFail = false;
  const acknowledged: string[] = [];
  const engine = new ExpenseSync({ householdId: "home", userId: "a", makeOperationId: () => `operation-${++counter}`,
    storage: { getItem: async key => store.get(key) ?? null, setItem: async (key, value) => { if (storageFail) throw new Error("storage failed"); store.set(key, value); } },
    fetch: async () => holdFetch ?? structuredClone(server),
    mutate: async op => {
      calls.push(op);
      await holdMutation;
      if (fail) throw fail;
      if (receipts.has(op.operationId)) return receipts.get(op.operationId)!;
      const current = server.find(value => value.id === op.expenseId);
      let result: ExpenseMutationResult;
      if (op.action === "delete") { server = server.filter(value => value.id !== op.expenseId); result = { id: op.expenseId, deleted: true, expense: null }; }
      else {
        const next = { ...(current ?? row(op.expenseId)), version: (current?.version ?? 0) + 1 };
        if (op.action === "repay") next.entry = { ...next.entry, paidBack: { ...next.entry.paidBack, a: true } };
        server = [...server.filter(value => value.id !== next.id), next];
        result = { id: next.id, deleted: false, expense: next };
      }
      receipts.set(op.operationId, result);
      return result;
    }, onRows: rows => { displayed = rows; }, onState: next => { state = next; }, onAcknowledged: op => acknowledged.push(op.operationId),
  });
  return { engine, store, calls, receipts, acknowledged, get displayed() { return displayed; }, get state() { return state; },
    set server(value: ExpenseRow[]) { server = value; }, set fail(value: unknown) { fail = value; }, set holdFetch(value: Promise<ExpenseRow[]> | undefined) { holdFetch = value; }, set holdMutation(value: Promise<void> | undefined) { holdMutation = value; }, set storageFail(value: boolean) { storageFail = value; } };
}

// Empty normalized data is authoritative; no bootstrap writes or inferred deletes.
{
  const f = fixture([]);
  await f.engine.initialize();
  assert.equal(f.state.ready, true);
  assert.equal(f.displayed.length, 0);
  assert.deepEqual(f.calls, []);
  f.server = [row("new-other-device")];
  await f.engine.refresh();
  assert.equal(f.displayed[0].id, "new-other-device");
  assert.deepEqual(f.calls, [], "reading a new expense must never delete it");
}
// In-flight hydration cannot overwrite a newer realtime repayment or restore a delete.
{
  const f = fixture(); await f.engine.initialize();
  const d = deferred<ExpenseRow[]>(); f.holdFetch = d.promise;
  const refresh = f.engine.refresh();
  f.engine.receive(row("one", 3, { b: true }));
  f.engine.receive(row("two", 2));
  f.engine.receive({ id: "deleted", household_id: "home" }, true);
  d.resolve([row("one"), row("deleted")]); await refresh;
  assert.equal(f.displayed.find(value => value.id === "one")?.entry.paidBack?.b, true);
  assert(f.displayed.some(value => value.id === "two"));
  assert(!f.displayed.some(value => value.id === "deleted"));
  f.engine.receive(row("one", 2));
  assert.equal(f.displayed.find(value => value.id === "one")?.version, 3);
}
// Failed writes stay durable and unapplied; retry reuses the same id, even after restart.
{
  const f = fixture(); await f.engine.initialize(); f.fail = new TypeError("Network request failed");
  await assert.rejects(f.engine.submit("repay", "one"), ExpensePendingError);
  assert.equal(f.state.pending, 1);
  assert.equal(f.displayed[0].entry.paidBack?.a, undefined, "no false success before acknowledgement");
  const op = f.calls[0];
  assert(JSON.parse(f.store.get(f.engine.storageKey)!).operations.length === 1);
  f.fail = undefined;
  await f.engine.retry();
  assert.equal(f.calls[1].operationId, op.operationId);
  assert.equal(f.displayed[0].entry.paidBack?.a, true);
  assert.equal(f.state.pending, 0);
  assert.equal(f.acknowledged.length, 1);
}
// Crash/restart loads only this user/household's durable intent, and lost responses replay receipts.
{
  const store = new Map<string, string>();
  const f = fixture([row("one")], store); await f.engine.initialize(); f.fail = new TypeError("offline");
  await assert.rejects(f.engine.submit("create", "created-id", { title: "New" }), ExpensePendingError);
  const persisted = store.get(f.engine.storageKey)!; f.engine.dispose();
  const g = fixture([row("one")], store); await g.engine.initialize();
  assert.equal(g.calls.length, 1);
  assert.equal(g.calls[0].expenseId, "created-id");
  assert.equal(g.state.pending, 0);
  assert.equal(JSON.parse(persisted).operations[0].operationId, g.calls[0].operationId);
}
// Duplicate offline Send is one durable creation, not a second charge.
{
  const f = fixture(); await f.engine.initialize(); f.fail = new Error("offline");
  await assert.rejects(f.engine.submit("create", "first-id", { title: "New", amountCents: 100 }), ExpensePendingError);
  await assert.rejects(f.engine.submit("create", "new-id", { title: "New", amountCents: 100 }), ExpensePendingError);
  assert.equal(f.state.pending, 1);
  assert.equal(f.calls[0].operationId, f.calls[1].operationId);
}
// Explicit delete only; stale edits are rejected visibly and do not poison later work.
{
  const f = fixture([row("one"), row("two")]); await f.engine.initialize();
  f.fail = { code: "P0001", message: "This expense changed. Refresh and try again." };
  await assert.rejects(f.engine.submit("update", "one", { title: "edit" }, 1), /changed/);
  assert.equal(f.state.pending, 0);
  f.fail = undefined;
  await f.engine.submit("delete", "two", {}, 1);
  assert.deepEqual(f.displayed.map(value => value.id), ["one"]);
  assert.equal(f.calls[1].action, "delete");
  assert.equal(f.calls[1].expectedVersion, 1);
}
// Account/household disposal cannot apply a late result; durable command is replayable.
{
  const f = fixture(); await f.engine.initialize(); const gate = deferred<void>(); f.holdMutation = gate.promise;
  const mutation = f.engine.submit("settle", "one", {}, 1);
  await new Promise(resolve => setTimeout(resolve, 0));
  f.engine.dispose(); gate.resolve();
  await assert.rejects(mutation, /Sweet changed/);
  assert.equal(f.state.pending, 1);
  assert.equal(f.acknowledged.length, 0);
}
// Failed local durability prevents sending; queue recovers after storage returns.
{
  const f = fixture(); await f.engine.initialize(); f.storageFail = true;
  await assert.rejects(f.engine.submit("repay", "one"), /saved on your device/);
  assert.equal(f.calls.length, 0);
  f.storageFail = false;
  await f.engine.submit("repay", "one");
  assert.equal(f.state.pending, 0);
}
// A request rejected during automatic replay has no awaiting form to display
// its error, so authoritative reconciliation must retain the rejection notice.
{
  const f = fixture(); await f.engine.initialize();
  f.fail = new TypeError("offline");
  await assert.rejects(f.engine.submit("update", "one", { title: "Saved edit" }, 1), ExpensePendingError);
  f.fail = { code: "P0001", message: "This expense changed. Refresh and try again." };
  await f.engine.retry();
  assert.equal(f.state.pending, 0, "the permanently rejected command stops blocking this expense");
  assert.match(f.state.error ?? "", /expense changed/, "background replay must explain why the saved request was rejected");
}

// A lost creation response must not restore an expense deleted before receipt replay,
// including after restart when the old engine's deletion tombstones are gone.
for (const restart of [false, true]) {
  const store = new Map<string, string>();
  const receipts = new Map<string, ExpenseMutationResult>();
  let server: ExpenseRow[] = [];
  let displayed: ExpenseRow[] = [];
  let counter = 0;
  const calls: ExpenseOperation[] = [];
  const makeEngine = () => new ExpenseSync({
    householdId: "home", userId: "a", makeOperationId: () => `lost-response-${++counter}`,
    storage: { getItem: async key => store.get(key) ?? null, setItem: async (key, value) => { store.set(key, value); } },
    fetch: async () => structuredClone(server),
    mutate: async operation => {
      calls.push(operation);
      const receipt = receipts.get(operation.operationId);
      if (receipt) return structuredClone(receipt); // Deliberately simulate a historical receipt from an older server.
      const created = row(operation.expenseId);
      server = [created];
      receipts.set(operation.operationId, { id: created.id, deleted: false, expense: created });
      throw new TypeError("Response lost after server COMMIT");
    },
    onRows: rows => { displayed = rows; }, onState: () => {},
  });
  let engine = makeEngine();
  await engine.initialize();
  await assert.rejects(engine.submit("create", "lost-created", { title: "New expense" }), ExpensePendingError);
  assert.equal(server[0].id, "lost-created", "the original operation really committed before its response was lost");
  assert.equal(engine.state.pending, 1);
  // A different household member deletes the committed expense before retry.
  server = [];
  engine.receive({ id: "lost-created", household_id: "home" }, true);
  if (restart) {
    engine.dispose();
    engine = makeEngine();
    await engine.initialize();
  } else {
    // Lagging Realtime UPDATEs cannot defeat a confirmed deletion either.
    engine.receive(row("lost-created"));
    assert.deepEqual(displayed, []);
    await engine.retry();
  }
  assert.equal(calls.length, 2);
  assert.equal(calls[0].operationId, calls[1].operationId, "replay retains the durable idempotency key");
  assert.equal(engine.state.pending, 0);
  assert.deepEqual(displayed, [], `receipt replay reconciles current authoritative absence (restart=${restart})`);
  assert.deepEqual(server, [], "receipt replay never creates another database record");
  engine.dispose();
}

console.log("expense command durability, hydration, retry, and scope tests passed");
