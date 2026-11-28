import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { withShoppingOrder } from "./shoppingRow.ts";
const source = ts.createSourceFile("AppContext.tsx", readFileSync("context/AppContext.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map<string, ts.Node>();
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ["addShoppingList", "addShoppingItem"].includes(node.name.getText(source)) && node.initializer && ts.isCallExpression(node.initializer)) callbacks.set(node.name.getText(source), node.initializer.arguments[0]);
  ts.forEachChild(node, visit);
}
visit(source);
const code = ts.transpileModule([...callbacks].map(([name, node]) => `exports.${name}=${node.getText(source)};`).join("\n"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture() {
  let resolve!: () => void, reject!: (error: Error) => void;
  let gate: Promise<void>;
  const nextGate = () => { gate = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); };
  nextGate();
  const listRef = { current: [] as any[] }, itemRef = { current: [] as any[] };
  const activeUserIdRef = { current: "me" }, activeSetupHouseholdRef = { current: "home" };
  const calls: string[] = [], analytics: string[] = [];
  const exports: any = {};
  const set = (ref: typeof listRef) => (next: any) => { ref.current = typeof next === "function" ? next(ref.current) : next; };
  runInNewContext(code, { exports, Error, Object, session: { user: { id: "me" } }, householdId: "home", currentUserId: "me", activeUserIdRef, activeSetupHouseholdRef,
    shoppingListsRef: listRef, shoppingItemsRef: itemRef, setShoppingLists: set(listRef), setShoppingItems: set(itemRef), withShoppingOrder,
    recordShoppingVersions: () => {}, makeId: () => "generated-id",
    shoppingListsTableReadyRef: { current: true, flush: async () => { calls.push("lists"); await gate; } },
    shoppingItemsTableReadyRef: { current: true, flush: async () => { calls.push("items"); } },
    track: { shoppingListCreated: () => analytics.push("list"), shoppingItemAdded: () => analytics.push("item") },
    prepareItemNameAnalytics: () => () => analytics.push("name"),
  });
  return { ...exports, listRef, itemRef, calls, analytics, nextGate, resolve: () => resolve(), reject: (error: Error) => reject(error), activeUserIdRef, activeSetupHouseholdRef };
}
let f = fixture();
let saved = f.addShoppingList("Draft", undefined, undefined, "stable-list");
assert.equal(typeof saved?.then, "function", "list creation must wait for actual persistence");
assert.equal(f.listRef.current[0].id, "stable-list"); assert.deepEqual(f.analytics, []);
f.reject(new Error("Offline")); await assert.rejects(saved, /Offline/);
f.nextGate(); saved = f.addShoppingList("Edited draft", "2026-11-27", "19:30", "stable-list");
assert.equal(f.listRef.current.length, 1, "retry must reuse the original list ID");
f.resolve(); assert.equal(await saved, "stable-list"); assert.deepEqual(f.analytics, ["list"]);
assert.equal(f.listRef.current[0].name, "Edited draft");
f = fixture(); f.listRef.current = [{ id: "parent", name: "Parent" }]; const item = { name: "Milk", quantity: "1", listId: "parent", addedBy: "me", completed: false };
saved = f.addShoppingItem(item, "stable-item"); assert.equal(typeof saved?.then, "function"); assert.deepEqual(f.analytics, []);
f.reject(new Error("Offline")); await assert.rejects(saved, /Offline/);
f.nextGate(); saved = f.addShoppingItem({ ...item, name: "Milk retry" }, "stable-item"); f.resolve();
assert.equal(await saved, "stable-item"); assert.equal(f.itemRef.current.length, 1); assert.deepEqual(f.calls, ["lists", "lists", "items"]);
assert.deepEqual(f.analytics, ["item", "name"]);
f = fixture(); saved = f.addShoppingList("Wrong scope", undefined, undefined, "late"); f.activeUserIdRef.current = "someone-else"; f.resolve();
await assert.rejects(saved, /account|household changed/i); assert.deepEqual(f.analytics, []);
console.log("Shopping draft persistence passed: acknowledged saves, stable retries, parent ordering and account boundaries.");

const sheetSource = ts.createSourceFile("ShoppingEditorSheet.tsx", readFileSync("components/ShoppingEditorSheet.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const sheetCallbacks = new Map<string, ts.Node>();
function visitSheet(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ["save", "close"].includes(node.name.getText(sheetSource)) && node.initializer) sheetCallbacks.set(node.name.getText(sheetSource), node.initializer);
  ts.forEachChild(node, visitSheet);
}
visitSheet(sheetSource);
const sheetCode = ts.transpileModule([...sheetCallbacks].map(([name, node]) => `exports.${name}=${node.getText(sheetSource)};`).join("\n"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function sheetFixture() {
  const state = { saving: false, error: null as string | null, calls: 0, closes: 0 };
  const working = { current: false }, generation = { current: 0 };
  let resolve!: () => void, reject!: (error: Error) => void, gate: Promise<void>;
  const nextGate = () => { gate = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); }; nextGate();
  const exports: any = {};
  runInNewContext(sheetCode, { exports, name: "Retained draft", editingDate: false, working, generation, Keyboard: { dismiss: () => {} },
    setEditingDate: () => {}, onClose: () => state.closes++, onSave: () => { state.calls++; return gate; },
    setSaving: (value: boolean) => { state.saving = value; }, setError: (value: string | null) => { state.error = value; } });
  return { ...exports, state, nextGate, resolve: () => resolve(), reject: (error: Error) => reject(error), generation };
}
let editor = sheetFixture(); let pending = editor.save(); editor.save(); editor.close();
assert.equal(editor.state.calls, 1, "double submission is ignored"); assert.equal(editor.state.saving, true); assert.equal(editor.state.closes, 0);
editor.reject(new Error("Check your connection and try again.")); await pending;
assert.equal(editor.state.saving, false); assert.equal(editor.state.error, "Check your connection and try again."); assert.equal(editor.state.closes, 0);
editor.nextGate(); pending = editor.save(); assert.equal(editor.state.error, null); editor.resolve(); await pending; assert.equal(editor.state.calls, 2);
editor = sheetFixture(); pending = editor.save(); editor.generation.current++; editor.reject(new Error("Old scope failure")); await pending;
assert.equal(editor.state.error, null, "a hidden/changed editor must not show an old error");
console.log("Shopping editor save controls passed: failure retention, retry, double-submit guard and stale-error suppression.");
