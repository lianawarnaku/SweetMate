import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as sync from "./normalizedCollection.ts";
import { fetchAllRows } from "./pagination.ts";
import { saveFeedback, saveRequest } from "./saveFeedback.ts";
import { rowToShoppingList, shoppingListToRow, rowToShoppingItem, shoppingItemToRow, withShoppingOrder, compareShoppingListRows } from "./shoppingRow.ts";
import type { ShoppingList } from "../context/AppContext.ts";

const home = "test-household";
const list: ShoppingList = { id: "essentials", name: "Sweet Essentials: Kitchen", sourceType: "sweet_essentials", sourceCategoryId: "kitchen" };
const row = { ...shoppingListToRow(list, home), updated_at: "2026-11-26T15:00:00.000Z" };
assert.equal(sync.planNormalizedSync([rowToShoppingList(row)], new Map([[row.id, row]]), value => shoppingListToRow(value, home), value => shoppingListToRow(rowToShoppingList(value), home, value.sort_order)).upserts.length, 0,
  "server timestamps introduced during hydration must not queue another write");
const reverseKeys = (value: any): any => Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) : value;
assert.equal(sync.normalizedRowFingerprint(row), sync.normalizedRowFingerprint(reverseKeys(row)), "JSONB key order is not an edit");
assert.equal(sync.planNormalizedSync([{ ...rowToShoppingList(row), pinned: true }], new Map([[row.id, row]]), value => shoppingListToRow(value, home), value => shoppingListToRow(rowToShoppingList(value), home, value.sort_order)).upserts.length, 1);

// Execute the actual hook with controlled network timing and two independent clients.
const module: any = {}, clients = new Set<any>(), fixtures = new Set<any>(), server = new Map<string, any>();
const requests: Array<{ method: string; household: string; ids: string[] }> = [], errors: unknown[] = [];
let rejectWrites = false, rejectReads = false, readCap = 1000, loseAcknowledgement = false;
let deferRead: (() => Promise<void>) | undefined;
const serverTables = new Map<string, string>();
let current: any, deferWrite: (() => Promise<void>) | undefined, rejectNext = false, stamp = 0;
const emit = (type: string, value: any, table = "shopping_lists") => {
  for (const client of clients) if (client.subscribed) for (const listener of client.listeners) {
    if (listener.options.table !== table) continue;
    if (listener.options.event !== type && listener.options.event !== "*") continue;
    // Match the real RLS/replica-identity default: deleted rows only have IDs,
    // so household-filtered listeners cannot receive those events.
    if (listener.options.filter && (type === "DELETE" || listener.options.filter !== `household_id=eq.${value.household_id}`)) continue;
    listener.handler({ eventType: type, old: type === "DELETE" ? { id: value.id } : {}, new: type === "DELETE" ? {} : value });
  }
};
const api = {
  channel: () => {
    const client: any = { listeners: [] }; clients.add(client);
    const channel = { client, on: (_event: string, options: any, handler: any) => { client.listeners.push({ options, handler }); return channel; },
      subscribe: (callback: any) => { client.subscribed = true; client.status = callback; callback("SUBSCRIBED"); return channel; } };
    return channel;
  },
  removeChannel: (channel: any) => { clients.delete(channel.client); },
  from: (table: string) => ({
    select: () => {
      let household = "", after: string | null = null, count = 250;
      const builder: any = {
        eq: (_key: string, value: string) => { household = value; return builder; },
        order: () => builder, gt: (_key: string, value: string) => { after = value; return builder; },
        limit: (value: number) => { count = value; return builder; },
        then: async (yes: any, no: any) => {
          const snapshot = [...server.values()].filter(value => value.household_id === household && (serverTables.get(value.id) ?? "shopping_lists") === table && (!after || value.id > after))
            .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0, Math.min(count, readCap));
          const gate = deferRead; deferRead = undefined; if (gate) await gate();
          return Promise.resolve(rejectReads ? { data: null, error: { message: "offline" } } : { data: snapshot, error: null }).then(yes, no);
        },
      }; return builder;
    },
    upsert: (rows: any[]) => {
      const request = (async () => {
      requests.push({ method: "upsert", household: rows[0].household_id, ids: rows.map(value => value.id) });
      const gate = deferWrite; deferWrite = undefined; if (gate) await gate();
      if (rejectNext || rejectWrites) { rejectNext = false; throw Error("temporary network failure"); }
      if (table === "shopping_items" && rows.some(row => !server.has(row.list_id))) return { error: { code: "23503", message: "shopping_items_list_id_fkey" } };
      for (const next of rows) {
        const type = server.has(next.id) ? "UPDATE" : "INSERT";
        const saved = reverseKeys(JSON.parse(JSON.stringify({ ...next, updated_at: new Date(1795705200000 + ++stamp).toISOString() })));
        server.set(saved.id, saved); serverTables.set(saved.id, table); if (!loseAcknowledgement) emit(type, saved, table);
      }
      if (loseAcknowledgement) { loseAcknowledgement = false; throw Error("Acknowledgement lost after commit"); }
      return { error: null };
      })();
      return Object.assign(request, { abortSignal: () => request });
    },
    delete: () => ({ eq: (_key: string, household: string) => ({ in: (_ids: string, ids: string[]) => {
      const request = (async () => {
      requests.push({ method: "delete", household, ids });
      for (const id of ids) { const value = server.get(id); if (value?.household_id === household) { server.delete(id); serverTables.delete(id); emit("DELETE", value, table); } }
      return { error: null };
      })(); return Object.assign(request, { abortSignal: () => request });
    } }) }),
  }),
};
const react = {
  useRef: (value: any) => { const index = current.cursor++; return current.slots[index] ??= { current: value }; },
  useState: (value: any) => {
    const owner = current, index = owner.cursor++;
    const slot = owner.slots[index] ??= { value, set: (next: any) => { const result = typeof next === "function" ? next(slot.value) : next; if (!Object.is(slot.value, result)) { slot.value = result; owner.dirty = true; } } };
    return [slot.value, slot.set];
  },
  useEffect: (effect: any, dependencies: any[]) => {
    const owner = current, index = owner.cursor++, prior = owner.effects[index];
    if (prior && dependencies.every((value, i) => Object.is(value, prior.dependencies[i]))) return;
    owner.pending.push(() => { prior?.cleanup?.(); owner.effects[index] = { dependencies, cleanup: effect() }; });
  },
};
const code = ts.transpileModule(readFileSync("hooks/useNormalizedCollection.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: false, target: ts.ScriptTarget.ES2022 } }).outputText;
runInNewContext(code, { exports: module, Map, Set, Date, Promise, Error, require: (name: string) => {
  if (name === "react") return react;
  if (name === "@/lib/supabase") return { supabase: api };
  if (name === "@/lib/pagination") return { fetchAllRows };
  if (name === "@/lib/saveFeedback") return { saveFeedback, saveRequest };
  if (name === "@/lib/normalizedCollection") return sync;
  if (name === "@/lib/runtimeDiagnostics") return { reportRuntimeError: (...args: unknown[]) => errors.push(args), reportSupabaseError: (...args: unknown[]) => errors.push(args) };
  throw Error(name);
} });
function fixture(cached: any[] = [], legacy: any[] = [], options: Record<string, any> = {}) {
  const state: any = { cursor: 0, slots: [], effects: [], pending: [], dirty: true, entities: cached, household: home, user: "test-member", deleted: new Set<string>(), ref: { current: cached }, legacy: { current: legacy } };
  state.setEntities = (next: any) => { state.entities = typeof next === "function" ? next(state.entities) : next; state.dirty = true; };
  state.render = () => {
    state.dirty = false; current = state; state.cursor = 0; state.ref.current = state.entities;
    state.handle = module.useNormalizedCollection({ table: options.table ?? "shopping_lists", householdId: state.household, userId: state.user, cloudReady: true,
      entities: state.entities, entitiesRef: state.ref, setEntities: state.setEntities, toRow: options.toRow ?? shoppingListToRow, fromRow: options.fromRow ?? rowToShoppingList, beforePersist: options.beforePersist,
      compareRows: options.table === "shopping_items" ? undefined : compareShoppingListRows, bootstrapEntitiesRef: state.legacy, deletedIds: () => [...state.deleted] });
    state.pending.splice(0).forEach((effect: any) => effect());
  };
  state.local = (next: any[]) => { state.entities = next; state.ref.current = next; state.dirty = true; state.render(); };
  state.remove = () => { state.effects.forEach((effect: any) => effect?.cleanup?.()); fixtures.delete(state); };
  fixtures.add(state); state.render(); return state;
}
async function settle() {
  for (let i = 0; i < 100; i++) { await Promise.resolve(); for (const state of fixtures) if (state.dirty) state.render(); assert(requests.length < 40, "server echoes must not loop"); }
}
function reset() { for (const state of [...fixtures]) state.remove(); clients.clear(); server.clear(); requests.length = errors.length = 0; deferWrite = undefined; rejectNext = false; rejectWrites = false; rejectReads = false; deferRead = undefined; serverTables.clear(); readCap = 1000; loseAcknowledgement = false; saveFeedback.setScope(""); }
{
  reset(); server.set(row.id, row); const a = fixture(), b = fixture(); await settle();
  assert.equal(requests.length, 0, "opening two members must not rewrite identical rows");
  emit("DELETE", { id: "another-household-list", household_id: "unrelated-household" }); await settle();
  assert.equal(a.entities[0].id, list.id, "unrelated deletion IDs cannot affect this household");
  let release!: () => void; deferWrite = () => new Promise<void>(resolve => { release = resolve; });
  a.local([{ ...a.entities[0], pinned: true }]); await settle(); assert(release);
  a.deleted.add(row.id); a.local([]); await settle(); release(); await settle();
  assert.equal(a.entities.length, 0, "late acknowledgement cannot restore the deleted list");
  assert.equal(b.entities.length, 0, "the other member must also remove the list"); assert.equal(server.size, 0);
  emit("UPDATE", row); await settle(); assert.equal(a.entities.length, 0, "replayed updates remain suppressed");
  assert.equal(requests.filter(request => request.method === "upsert").length, 1, "only the actual pre-delete edit was written");
}
{
  reset(); const stale = fixture([rowToShoppingList(row)]); await settle();
  assert.equal(stale.entities.length, 0, "reopening an empty household discards stale cached lists"); assert.equal(requests.length, 0);
}
{
  reset(); const legacy = fixture([], [list]); await settle();
  assert.equal(legacy.entities[0].id, list.id, "genuine legacy server data still migrates"); assert.equal(server.size, 1);
}
{
  reset(); server.set(row.id, row); const a = fixture(); await settle();
  rejectNext = true; a.local([{ ...a.entities[0], pinned: true }]); await settle(); assert.equal(errors.length, 1);
  a.deleted.add(row.id); a.local([]); await settle(); assert.equal(server.size, 0, "failed writes must not poison the delete queue");
}
{
  reset(); server.set(row.id, row); const a = fixture(); await settle();
  let release!: () => void; deferWrite = () => new Promise<void>(resolve => { release = resolve; });
  a.local([{ ...a.entities[0], pinned: true }]); await settle(); a.deleted.add(row.id); a.local([]);
  a.household = "another-household"; a.legacy.current = []; a.entities = []; a.ref.current = []; a.render(); await settle();
  release(); await settle(); assert.equal(a.entities.length, 0, "old responses cannot populate another household");
  assert(!requests.some(request => request.method === "delete"), "queued old-household deletes must stop after switching");
}
{
  reset(); const parent = fixture(); await settle();
  const child = fixture([], [], { table: "shopping_items", toRow: shoppingItemToRow, fromRow: rowToShoppingItem, beforePersist: () => parent.handle.flush() }); await settle();
  let release!: () => void; deferWrite = () => new Promise<void>(resolve => { release = resolve; });
  parent.local([list]); await settle();
  child.local([{ id: "new-essential", listId: list.id, name: "New essential", quantity: "1", completed: false, addedBy: "test-member" }]);
  await settle();
  assert.equal(server.has("new-essential"), false, "child writes must wait while the new list is still saving");
  assert.equal(errors.length, 0, "a child must wait rather than attempting an insert that violates its parent's foreign key");
  release(); await settle();
  await child.handle.flush();
  assert(server.has(list.id)); assert(server.has("new-essential"));
  assert.equal(errors.length, 0, "bulk list+item creation must not hit a foreign-key error");
}
{
  reset(); const parent = fixture(); await settle();
  const child = fixture([], [], { table: "shopping_items", toRow: shoppingItemToRow, fromRow: rowToShoppingItem, beforePersist: () => parent.handle.flush() }); await settle();
  rejectWrites = true; parent.local([list]); child.local([{ id: "retry-essential", listId: list.id, name: "Retry essential", quantity: "1", completed: false, addedBy: "test-member" }]); await settle();
  await assert.rejects(child.handle.flush(), /temporary network failure/, "flush must reject instead of announcing a saved transfer");
  rejectWrites = false;
  await child.handle.flush(); await settle();
  assert(server.has("retry-essential"), "retry must reuse the pending child and save its parent first");
}
{
  reset();
  const initial = [list, { ...list, id: "second", name: "Second" }, { ...list, id: "third", name: "Third" }];
  initial.forEach((entry, index) => server.set(entry.id, shoppingListToRow(entry, home, index)));
  const a = fixture(), b = fixture(); await settle();
  a.local(withShoppingOrder([{ ...a.entities[2], pinned: true }, a.entities[0], a.entities[1]])); await settle();
  assert.deepEqual(Array.from(b.entities, (entry: any) => entry.id), ["third", list.id, "second"], "a remote pin/reorder must reorder the other member without writing the old order back");
  const reopened = fixture(); await settle();
  assert.deepEqual(Array.from(reopened.entities, (entry: any) => entry.id), ["third", list.id, "second"], "reopening must preserve the saved list order");
}

{
  reset(); server.set(list.id, shoppingListToRow(list, home));
  const parent = fixture(); await settle();
  const initial = ["milk", "rice", "soap"].map((id, sortOrder) => ({ id, listId: list.id, name: id, quantity: "1", completed: false, addedBy: "test-member", sortOrder }));
  initial.forEach(entry => { server.set(entry.id, shoppingItemToRow(entry, home)); serverTables.set(entry.id, "shopping_items"); });
  const options = { table: "shopping_items", toRow: shoppingItemToRow, fromRow: rowToShoppingItem, beforePersist: () => parent.handle.flush() };
  const a = fixture([], [], options), b = fixture([], [], options); await settle();
  a.local(withShoppingOrder([a.entities[2], a.entities[0], a.entities[1]])); await settle();
  assert.deepEqual(Array.from(b.entities, (entry: any) => entry.id), ["soap", "milk", "rice"], "item reorder reaches the other member without an echo overwrite");
  const reopened = fixture([], [], options); await settle();
  assert.deepEqual(Array.from(reopened.entities, (entry: any) => entry.id), ["soap", "milk", "rice"], "item order survives reopening");
}

{
  reset();
  server.set(list.id, shoppingListToRow(list, home, 0));
  server.set("old-pinned", shoppingListToRow({ ...list, id: "old-pinned", pinned: true }, home, 5));
  const reopened = fixture(); await settle();
  assert.equal(reopened.entities[0].id, "old-pinned", "legacy rows with a pin but an old rank still load in the pinned partition");
  assert.equal(requests.length, 0, "loading a legacy pin does not rewrite other members' saved order");
}

// Failure recovery and interrupted reads must be tested independently of initial hydration.
const recoveryFailures: string[] = [];
async function recovery(name: string, action: () => Promise<void>) {
  try { await action(); console.log(`PASS recovery: ${name}`); }
  catch (error) { recoveryFailures.push(name); console.error(`FAIL recovery: ${name}: ${String(error)}`); }
}
await recovery("offline cold launch reconnects", async () => {
  reset(); server.set(row.id, row); rejectReads = true;
  const a = fixture(); await settle();
  assert.equal(a.handle.current, false);
  rejectReads = false;
  for (const client of clients) client.status?.("SUBSCRIBED");
  await settle();
  assert.equal(a.handle.current, true, "a failed initial SELECT must recover when the connection returns");
  assert.equal(a.entities[0]?.id, row.id);
});
await recovery("missed peer changes refresh on reconnect", async () => {
  reset(); server.set(row.id, row); const a = fixture(); await settle();
  server.delete(row.id); server.set("peer-added", shoppingListToRow({ id: "peer-added", name: "Added while disconnected" }, home));
  for (const client of clients) client.status?.("SUBSCRIBED");
  await settle();
  assert.deepEqual(Array.from(a.entities, (entity: any) => entity.id), ["peer-added"], "reconnecting must reconcile missed peer additions and deletions");
  assert.equal(requests.length, 0, "reconnecting must not write stale rows back");
});
await recovery("offline create retries without losing the peer snapshot", async () => {
  reset(); server.set(row.id, row); const a = fixture(); await settle();
  rejectWrites = true; a.local([...a.entities, { id: "offline-new", name: "Retry once online" }]); await settle();
  server.set("peer-added", shoppingListToRow({ id: "peer-added", name: "From peer" }, home));
  rejectWrites = false;
  for (const client of clients) client.status?.("SUBSCRIBED");
  await settle(); await a.handle.flush(); await settle();
  assert(server.has("offline-new"));
  assert.deepEqual(Array.from(a.entities, (entity: any) => entity.id).sort(), [list.id, "offline-new", "peer-added"].sort());
});
await recovery("late initial read cannot cross households", async () => {
  reset(); server.set(row.id, row);
  let release!: () => void; deferRead = () => new Promise<void>(resolve => { release = resolve; });
  const a = fixture(); await settle(); assert(release);
  a.household = "another-household"; a.entities = []; a.ref.current = []; a.render(); await settle();
  release(); await settle();
  assert.equal(a.entities.length, 0); assert.equal(requests.length, 0);
});
await recovery("peer deletion wins over an unsaved offline edit", async () => {
  reset(); server.set(row.id, row); const a = fixture(); await settle();
  rejectWrites = true; a.local([{ ...a.entities[0], name: "Offline edit" }]); await settle();
  server.delete(row.id); rejectWrites = false;
  for (const client of clients) client.status?.("SUBSCRIBED");
  await settle(); await a.handle.flush(); await settle();
  assert.equal(server.size, 0); assert.equal(a.entities.length, 0);
});
await recovery("two overlapping edits converge", async () => {
  reset(); server.set(row.id, row); const a = fixture(), b = fixture(); await settle();
  a.local([{ ...a.entities[0], name: "A's edit" }]); b.local([{ ...b.entities[0], name: "B's edit" }]); await settle();
  assert.equal(a.entities[0].name, b.entities[0].name);
  assert.equal(a.entities[0].name, rowToShoppingList(server.get(row.id)).name);
});
await recovery("account switch discards a delayed read", async () => {
  reset(); server.set(row.id, row);
  let release!: () => void; deferRead = () => new Promise<void>(resolve => { release = resolve; });
  const a = fixture(); await settle(); assert(release);
  server.clear(); a.user = "another-user"; a.entities = []; a.ref.current = []; a.render(); await settle();
  release(); await settle(); assert.equal(a.entities.length, 0); assert.equal(requests.length, 0);
});
await recovery("pending pin remains first after reconnect", async () => {
  reset(); server.set(row.id, row); server.set("second", shoppingListToRow({ id: "second", name: "Second" }, home, 1));
  const a = fixture(); await settle(); rejectWrites = true;
  a.local(withShoppingOrder([{ ...a.entities[1], pinned: true }, a.entities[0]])); await settle();
  rejectWrites = false; for (const client of clients) client.status?.("SUBSCRIBED");
  await settle(); assert.equal(a.entities[0].id, "second");
});
await recovery("new entry survives an offline initial load", async () => {
  reset(); server.set(row.id, row); rejectReads = true; const a = fixture(); await settle();
  a.local([{ id: "before-ready", name: "Entered while waiting for connection" }]); await settle();
  rejectReads = false; for (const client of clients) client.status?.("SUBSCRIBED");
  await settle();
  assert(a.entities.some((entity: any) => entity.id === "before-ready"), "recovery must not discard an entry added after the first failed read");
  assert(server.has("before-ready"));
});
await recovery("cached edit made while offline remains pending", async () => {
  reset(); server.set(row.id, row); rejectReads = true; const a = fixture([rowToShoppingList(row)]); await settle();
  a.local([{ ...a.entities[0], name: "Edited before ready" }]); await settle();
  rejectReads = false; for (const client of clients) client.status?.("SUBSCRIBED");
  await settle(); assert.equal(a.entities[0].name, "Edited before ready");
  assert.equal(rowToShoppingList(server.get(row.id)).name, "Edited before ready");
});
await recovery("peer event received during refresh beats the old snapshot", async () => {
  reset(); server.set(row.id, row); const a = fixture(); await settle();
  let release!: () => void; deferRead = () => new Promise<void>(resolve => { release = resolve; });
  for (const client of clients) client.status?.("SUBSCRIBED"); await settle(); assert(release);
  const newer = { ...row, name: "Fresh peer name", entry: { ...row.entry, name: "Fresh peer name" } };
  server.set(row.id, newer); emit("UPDATE", newer); await settle(); release(); await settle();
  assert.equal(a.entities[0].name, "Fresh peer name"); assert.equal(requests.length, 0);
});
await recovery("peer deletes while another member's edit is in flight", async () => {
  reset(); server.set(row.id, row); const a = fixture(), b = fixture(); await settle();
  let release!: () => void; deferWrite = () => new Promise<void>(resolve => { release = resolve; });
  a.local([{ ...a.entities[0], name: "Delayed edit" }]); await settle(); assert(release);
  b.deleted.add(row.id); b.local([]); await settle();
  release(); await settle();
  assert.equal(server.size, 0); assert.equal(a.entities.length, 0); assert.equal(b.entities.length, 0);
});
reset();
assert.deepEqual(recoveryFailures, [], "all reconnect and isolation scenarios must pass");
console.log("Normalized collection tests passed: no echo loop, in-flight delete, two members, stale cache, legacy migration, failed writes and household isolation.");

{
  reset(); readCap = 71;
  for (let i = 0; i < 1207; i++) {
    const value = shoppingListToRow({ id: `page-${String(i).padStart(5, "0")}`, name: `Saved list ${i}` }, home, i);
    server.set(value.id, value);
  }
  const a = fixture();
  for (let i = 0; i < 30; i++) await settle();
  assert.equal(a.entities.length, 1207, "the actual sync hook must hydrate beyond both the server and requested page sizes");
  assert.equal(new Set(a.entities.map((entry: any) => entry.id)).size, 1207);
  assert.equal(requests.length, 0, "paging must not mistake unread rows for deletions or queue edits");
  a.local(a.entities.map((entry: any) => entry.id === "page-01206" ? { ...entry, pinned: true } : entry)); await settle();
  assert.equal(server.get("page-01206").pinned, true, "an item beyond the old cap remains editable");
  assert.equal(server.size, 1207, "saving a late-page edit must preserve every other row");
}

{
  reset(); server.set(row.id, row); saveFeedback.setScope(`test-member:${home}`); const a = fixture(); await settle();
  rejectWrites = true; a.local([{ ...a.entities[0], pinned: true }]); await settle();
  assert.equal(saveFeedback.getSnapshot().issues.find(issue => issue.key === "shopping_lists")?.phase, "failed");
  rejectWrites = false; await saveFeedback.retry(`test-member:${home}`); await settle();
  assert.equal(server.get(row.id).pinned, true); assert.equal(saveFeedback.getSnapshot().issues.length, 0);
}
{
  reset(); server.set(row.id, row); const a = fixture(); await settle();
  loseAcknowledgement = true; a.local([{ ...a.entities[0], pinned: true }]); await settle();
  assert.equal(server.get(row.id).pinned, true);
  a.local([{ ...a.entities[0], pinned: false }]); await settle();
  assert.equal(server.get(row.id).pinned, false, "undo after a committed-but-unacknowledged change must explicitly restore the latest choice");
  assert.equal(a.entities[0].pinned, false);
}
