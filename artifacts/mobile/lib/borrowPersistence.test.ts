import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { sharedBorrowToRow, rowToSharedBorrow } from "./sharedBorrowRow.ts";
import { hasValidBorrowParticipants, OTHER_BORROW_OWNER } from "./borrowValidation.ts";

const entry: any = { id: "draft-id", householdId: "home", creatorId: "avery", ownerId: "avery", item: "Charger", borrowedFrom: "other", externalOwnerName: "Alex", ownerName: "Alex", borrowedBy: "avery", borrowedAt: "2026-11-26T12:00:00Z", dueDate: "2026-12-03T23:59:00Z", createdAt: "2026-11-26T12:00:00Z", updatedAt: "2026-11-26T12:00:00Z", returned: false, visibility: "shared" };
function fixture(mode: string) {
  const requests: any[] = [], timers = new Map<number, () => void>(); let release: ((value?: any) => void) | undefined, timerId = 0;
  const module: any = {};
  const client = { from: (table: string) => ({ upsert: (row: any, options: any) => {
    requests.push({ table, row, options }); let signal: AbortSignal;
    const query = { select: () => query, abortSignal: (value: AbortSignal) => { signal = value; return query; }, single: async () => {
      if (mode === "pending" || mode === "timeout") await new Promise((resolve, reject) => { release = resolve; signal.addEventListener("abort", () => reject(Error("aborted")), { once: true }); });
      const data = { ...row, updated_at: "2026-11-26T15:00:00Z", ...(mode === "wrong-id" ? { id: "wrong" } : {}), ...(mode === "wrong-household" ? { household_id: "another-home" } : {}), ...(mode === "wrong-owner" ? { owner_id: "blake" } : {}) };
      return { data, error: mode === "denied" ? { code: "42501", message: "private database details" } : null };
    } };
    return query;
  } }) };
  const code = ts.transpileModule(readFileSync("lib/borrowPersistence.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports: module, Error, AbortController, setTimeout: (callback: () => void) => { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout: (id: number) => timers.delete(id), require: (name: string) => {
    if (name === "./supabase") return { supabase: client };
    if (name === "./sharedBorrowRow") return { sharedBorrowToRow, rowToSharedBorrow };
    if (name === "./runtimeDiagnostics") return { reportSupabaseError: () => {} };
    throw Error(name);
  } });
  return { save: module.saveBorrowRecord, requests, timers, resolve: () => release?.(), expire: () => [...timers.values()].forEach(callback => callback()) };
}
for (const visibility of ["shared", "private"]) {
  const f = fixture("success"); const saved = await f.save({ ...entry, visibility });
  assert.equal(saved.externalOwnerName, "Alex"); assert.equal(saved.id, entry.id); assert.equal(f.requests[0].options.onConflict, "id");
  assert.equal(f.requests[0].table, visibility === "shared" ? "shared_borrow_items" : "private_borrow_items");
  if (visibility === "shared") assert.equal(f.requests[0].row.borrowed_from, null, "outside names never go into UUID columns");
  else assert.equal(f.requests[0].row.owner_id, "avery", "private owner remains the signed-in account");
  assert.equal(f.timers.size, 0);
}
for (const mode of ["wrong-id", "wrong-household", "denied"]) {
  const f = fixture(mode); await assert.rejects(f.save(entry)); assert.equal(f.timers.size, 0);
}
await assert.rejects(fixture("wrong-owner").save({ ...entry, visibility: "private" }));
{
  const f = fixture("pending"); let finished = false;
  const save = f.save(entry).then(() => { finished = true; }); await Promise.resolve(); assert.equal(finished, false);
  f.resolve(); await save; assert.equal(finished, true);
}
{
  const f = fixture("timeout"); const save = f.save(entry); f.expire(); await assert.rejects(save, /Saving timed out/); assert.equal(f.timers.size, 0);
}
// Execute the real context create callback as well as the transport boundary.
const source = readFileSync("context/AppContext.tsx", "utf8"), syntax = ts.createSourceFile("context.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let create: ts.Expression | undefined;
const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(syntax) === "addBorrowItem" && node.initializer && ts.isCallExpression(node.initializer)) create = node.initializer.arguments[0]; ts.forEachChild(node, visit); };
visit(syntax); assert(create);
const module: any = {}, saved: any[] = [];
runInNewContext(ts.transpileModule(`exports.create = ${create.getText(syntax)}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
  exports: module, Date, OTHER_BORROW_OWNER, hasValidBorrowParticipants, session: { user: { id: "avery" } }, householdId: "home", roommates: [{ id: "avery", name: "Avery" }, { id: "blake", name: "Blake" }],
  visibleBorrowItemsRef: { current: [] }, makeId: () => "generated", persistAndPublishBorrow: async (value: any) => { saved.push(value); }, track: { borrowingItemAdded: () => {} },
});
assert.equal(await module.create(entry, "stable-draft"), "stable-draft");
assert.equal(saved[0].ownerId, "avery"); assert.equal(saved[0].externalOwnerName, "Alex");
assert.equal(await module.create({ ...entry, borrowedFrom: "avery" }, "self-draft"), "self-draft");
assert.equal(saved[1].externalOwnerName, undefined); assert.equal(saved[1].borrowedBy, "avery");
assert.equal(await module.create({ ...entry, borrowedBy: "outsider" }), null); assert.equal(saved.length, 2);
console.log("Borrowing server acknowledgement, privacy scope, outside-owner mapping, timeout cleanup, stable IDs and real context validation tests passed");
