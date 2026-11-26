import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
function fixture() {
  const values: any[] = []; let cursor = 0;
  const react = { useState: (initial: any) => { const slot = cursor++; if (!(slot in values)) values[slot] = typeof initial === "function" ? initial() : initial;
    return [values[slot], (next: any) => { values[slot] = typeof next === "function" ? next(values[slot]) : next; }]; },
    useRef: (initial: any) => { const slot = cursor++; if (!(slot in values)) values[slot] = { current: initial }; return values[slot]; }, useCallback: (fn: any) => fn };
  const exports: any = {};
  const code = ts.transpileModule(readFileSync("hooks/useVersionedCustomTasks.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, Date, require: (name: string) => { assert.equal(name, "react"); return react; } });
  return { render: () => { cursor = 0; return exports.useVersionedCustomTasks(); } };
}
const task = (id: string) => ({ id, item: id, title: id, difficulty: 3, frequency: "weekly", timeOfDay: "any" });
const a = fixture(), b = fixture();
a.render().mutate("a", task("a"));
assert.equal(a.render().applyRemote([], undefined), true, "an old empty echo must request writeback rather than erase a newly added custom task");
assert.equal(a.render().items[0].id, "a");
b.render().mutate("b", task("b"));
assert.equal(b.render().applyRemote(a.render().items, a.render().meta), true);
a.render().applyRemote(b.render().items, b.render().meta);
assert.equal(a.render().items.length, 2); assert.equal(b.render().items.length, 2);
const stale = JSON.parse(JSON.stringify(a.render()));
a.render().mutate("a");
assert(a.render().meta.deleted.a > a.render().meta.versions.a, "deletion version advances even when both actions share a millisecond");
a.render().applyRemote(stale.items, stale.meta);
assert.equal(a.render().items.some((item: any) => item.id === "a"), false, "a delayed update must not resurrect a deleted custom task");
b.render().applyRemote(a.render().items, a.render().meta);
assert.equal(b.render().items.some((item: any) => item.id === "a"), false);
const restored = fixture(), saved = JSON.parse(JSON.stringify(a.render()));
restored.render().restore(saved.items, saved.meta);
restored.render().applyRemote(stale.items, stale.meta);
assert.equal(restored.render().items.some((item: any) => item.id === "a"), false, "deletion intent survives saved cache restoration");
restored.render().mutate("new", task("new"));
assert.equal(restored.render().applyRemote(undefined), true, "a partial household event cannot swallow a new local mutation");
assert(restored.render().items.some((item: any) => item.id === "new"));
restored.render().restore([]);
assert.equal(Object.keys(restored.render().meta.versions).length, 0, "switching households must clear version intent");

// Execute the actual context handlers and remote applier with the real hook.
const source = readFileSync("context/AppContext.tsx", "utf8");
const ast = ts.createSourceFile("context.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks: Record<string, string> = {};
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ["addCustomTask", "deleteCustomTask", "applySharedState"].includes(node.name.text) && node.initializer && ts.isCallExpression(node.initializer)) callbacks[node.name.text] = node.initializer.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
const live = fixture(), applyingRemoteRef = { current: true };
const emptyShopping = { listVersions: {}, itemVersions: {}, deletedLists: {}, deletedItems: {} };
const exports: any = {};
const bindings: any = { exports, customTasks: [], prepareItemNameAnalytics: () => () => 0, applyingRemoteRef, makeId: () => "real-context-task", mutateCustomTask: (id: string, value: any) => live.render().mutate(id, value),
  applyRemoteCustomTasks: (items: any, meta: any) => live.render().applyRemote(items, meta),
  choresTableReadyRef: { current: true }, choresRef: { current: [] }, shoppingSyncMetaRef: { current: emptyShopping }, EMPTY_SHOPPING_SYNC_META: emptyShopping,
  shoppingListsTableReadyRef: { current: true }, shoppingItemsTableReadyRef: { current: true }, sharedBorrowTableReadyRef: { current: true }, setShoppingSyncMeta: () => {} };
const code = ts.transpileModule(Object.entries(callbacks).map(([name, callback]) => `exports.${name} = ${callback};`).join("\n"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
runInNewContext(code, bindings);
exports.addCustomTask(task("real"));
assert.equal(applyingRemoteRef.current, false, "an explicit Add must not inherit the remote-echo suppression flag");
exports.applySharedState({ customTasks: [] });
assert.equal(live.render().items.length, 1, "the real context remote handler must preserve the pending custom task");
assert.equal(applyingRemoteRef.current, false, "the merged state must be allowed to persist back to the server");
exports.deleteCustomTask("real");
exports.applySharedState({ customTasks: [task("real")] });
assert.equal(live.render().items.length, 0);
console.log("Custom-task context and hook preserve concurrent additions, deletions, cached intent, partial events and writeback after stale snapshots.");
