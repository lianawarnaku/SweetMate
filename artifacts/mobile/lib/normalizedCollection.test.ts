import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as sync from "./normalizedCollection.ts";
import { rowToShoppingList, shoppingListToRow } from "./shoppingRow.ts";
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
let current: any, deferWrite: (() => Promise<void>) | undefined, rejectNext = false, stamp = 0;
const emit = (type: string, value: any) => {
  for (const client of clients) if (client.subscribed) for (const listener of client.listeners) {
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
      subscribe: (callback: any) => { client.subscribed = true; callback("SUBSCRIBED"); } };
    return channel;
  },
  removeChannel: (channel: any) => { clients.delete(channel.client); },
  from: () => ({
    select: () => ({ eq: async (_key: string, household: string) => ({ data: [...server.values()].filter(value => value.household_id === household), error: null }) }),
    upsert: async (rows: any[]) => {
      requests.push({ method: "upsert", household: rows[0].household_id, ids: rows.map(value => value.id) });
      const gate = deferWrite; deferWrite = undefined; if (gate) await gate();
      if (rejectNext) { rejectNext = false; throw Error("temporary network failure"); }
      for (const next of rows) {
        const type = server.has(next.id) ? "UPDATE" : "INSERT";
        const saved = reverseKeys(JSON.parse(JSON.stringify({ ...next, updated_at: new Date(1795705200000 + ++stamp).toISOString() })));
        server.set(saved.id, saved); emit(type, saved);
      }
      return { error: null };
    },
    delete: () => ({ eq: (_key: string, household: string) => ({ in: async (_ids: string, ids: string[]) => {
      requests.push({ method: "delete", household, ids });
      for (const id of ids) { const value = server.get(id); if (value?.household_id === household) { server.delete(id); emit("DELETE", value); } }
      return { error: null };
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
  if (name === "@/lib/normalizedCollection") return sync;
  if (name === "@/lib/runtimeDiagnostics") return { reportRuntimeError: (...args: unknown[]) => errors.push(args), reportSupabaseError: (...args: unknown[]) => errors.push(args) };
  throw Error(name);
} });
function fixture(cached: ShoppingList[] = [], legacy: ShoppingList[] = []) {
  const state: any = { cursor: 0, slots: [], effects: [], pending: [], dirty: true, entities: cached, household: home, deleted: new Set<string>(), ref: { current: cached }, legacy: { current: legacy } };
  state.setEntities = (next: any) => { state.entities = typeof next === "function" ? next(state.entities) : next; state.dirty = true; };
  state.render = () => {
    state.dirty = false; current = state; state.cursor = 0; state.ref.current = state.entities;
    module.useNormalizedCollection({ table: "shopping_lists", householdId: state.household, userId: "test-member", cloudReady: true,
      entities: state.entities, entitiesRef: state.ref, setEntities: state.setEntities, toRow: shoppingListToRow, fromRow: rowToShoppingList,
      bootstrapEntitiesRef: state.legacy, deletedIds: () => [...state.deleted] });
    state.pending.splice(0).forEach((effect: any) => effect());
  };
  state.local = (next: ShoppingList[]) => { state.entities = next; state.ref.current = next; state.dirty = true; state.render(); };
  state.remove = () => { state.effects.forEach((effect: any) => effect?.cleanup?.()); fixtures.delete(state); };
  fixtures.add(state); state.render(); return state;
}
async function settle() {
  for (let i = 0; i < 100; i++) { await Promise.resolve(); for (const state of fixtures) if (state.dirty) state.render(); assert(requests.length < 40, "server echoes must not loop"); }
}
function reset() { for (const state of [...fixtures]) state.remove(); clients.clear(); server.clear(); requests.length = errors.length = 0; deferWrite = undefined; rejectNext = false; }
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
reset();
console.log("Normalized collection tests passed: no echo loop, in-flight delete, two members, stale cache, legacy migration, failed writes and household isolation.");
