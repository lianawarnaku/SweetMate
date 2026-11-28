import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { canonicalExpense, allExpenseSharesPaid } from "./expensePolicy.ts";
import { expenseRemainingCents } from "./expensePolicy.ts";
import { normalizeExpenseDate } from "./expenseDate.ts";
import { isBorrowReturnOwner } from "./borrowValidation.ts";
import { setShoppingCompletion } from "./shoppingCompletion.ts";
import { withShoppingOrder } from "./shoppingRow.ts";
import { transferEssentialsToShopping } from "./essentialShopping.ts";

// Run actual AppContext callbacks with local state/vendor substitutes.
const source = readFileSync(resolve(process.cwd(), "context/AppContext.tsx"), "utf8");
const parsed = ts.createSourceFile("AppContext.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name: string, bindings: Record<string, unknown>): (...args: any[]) => any {
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer && ts.isCallExpression(node.initializer)) expression = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert(expression, `missing action ${name}`);
  const compiled = ts.transpileModule(`exports.callback = ${expression.getText(parsed)};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: false, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: { callback?: (...args: any[]) => any } = {};
  runInNewContext(compiled, { exports, prepareItemNameAnalytics: () => () => 0, ...bindings });
  return exports.callback!;
}
const events: { event: string; properties?: Record<string, unknown> }[] = [];
const track = new Proxy({}, { get: (_target, event: string) => (properties?: Record<string, unknown>) => events.push({ event, properties }) });
const names = () => events.map((event) => event.event);
// Run the actual acknowledgement callback: failed network requests never
// count as completed financial actions.
const hookSource = readFileSync(resolve(process.cwd(), "hooks/useExpenseSync.ts"), "utf8");
const hookParsed = ts.createSourceFile("useExpenseSync.ts", hookSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let acknowledgement: ts.Expression | undefined;
function findAcknowledgement(node: ts.Node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(hookParsed) === "onAcknowledged") acknowledgement = node.initializer;
  ts.forEachChild(node, findAcknowledgement);
}
findAcknowledgement(hookParsed);
assert(acknowledgement);
const ackExports: { ack?: (...args: any[]) => void } = {};
runInNewContext(ts.transpileModule(`exports.ack = ${acknowledgement.getText(hookParsed)}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: false, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: ackExports, track, scopeRef: { current: "test" }, scope: "test", effectActive: true, loadActivity: async () => {} });
const expense = { id: "expense", paidBy: "payer", settled: false, splits: { payer: 2, a: 2, b: 2 }, version: 1 };
const expensesRef: { current: any[] } = { current: [expense] };
let rejectWrite = false;
let mutationCount = 0;
const mutateExpense = async (action: string, id: string) => {
  if (rejectWrite) throw new Error("network failure");
  mutationCount++;
  const old = expensesRef.current.find(value => value.id === id);
  const next = { ...old, settled: action === "settle" || !!old.paidBack?.a, paidBack: action === "repay" ? { ...old.paidBack, [old.paidBack?.a ? "b" : "a"]: true } : old.paidBack };
  expensesRef.current = [next];
  const result = { id, deleted: false, expense: { settled: next.settled } };
  ackExports.ack!({ action }, result);
  return result;
};
const markA = callback("markPersonPaid", { expensesRef, currentUserId: "a", mutateExpense, expenseRemainingCents, normalizeExpenseDate });
await assert.rejects(() => markA("expense", "payer"), /own repayment/);
assert.equal(await markA("missing", "a").catch(() => false), false);
rejectWrite = true;
await assert.rejects(() => markA("expense", "a"), /network failure/);
assert.equal(events.length, 0, "failed writes do not count as completed repayments");
rejectWrite = false;
assert.equal(await markA("expense", "a"), true);
assert.equal(await markA("expense", "a"), false);
assert.deepEqual(names(), ["expenseRepaymentRecorded"]);
assert.equal(events[0].properties?.settles_expense, false);
const markB = callback("markPersonPaid", { expensesRef, currentUserId: "b", mutateExpense, expenseRemainingCents, normalizeExpenseDate });
assert.equal(await markB("expense", "b"), true);
assert.deepEqual(names(), ["expenseRepaymentRecorded", "expenseRepaymentRecorded", "iouSettled"]);
assert.equal(events[2].properties?.source, "repayment");
assert.equal(mutationCount, 2, "duplicate presses never create a second repayment");
const settle = callback("settleExpense", { expensesRef, mutateExpense, canManageExpense: () => true });
assert.equal(await settle("expense"), false);
expensesRef.current = [{ ...expense }]; events.length = 0;
rejectWrite = true;
await assert.rejects(() => settle("expense"), /network failure/);
assert.equal(events.length, 0);
rejectWrite = false;
assert.equal(await settle("expense"), true);
assert.equal(await settle("expense"), false);
assert.deepEqual(names(), ["iouSettled"]);
const forbiddenSettle = callback("settleExpense", { expensesRef: { current: [{ ...expense }] }, mutateExpense: () => assert.fail("unauthorized mutation"), canManageExpense: () => false });
await assert.rejects(() => forbiddenSettle("expense"), /can’t settle/);
const shoppingItemsRef = { current: [{ id: "item", completed: false }] };
const completeShopping = callback("setShoppingItemCompleted", { shoppingItemsRef, setShoppingCompletion, recordShoppingVersions: () => {}, setShoppingItems: () => {}, track });
events.length = 0;
completeShopping("missing", true);
completeShopping("item", true);
completeShopping("item", true);
completeShopping("item", false);
completeShopping("item", false);
assert.deepEqual(names(), ["shoppingItemCompleted", "shoppingItemReopened"], "shopping completion and undo are distinct idempotent events");
const borrowed = { id: "borrow", borrowedFrom: "owner", borrowedBy: "borrower", returned: false, visibility: "shared" };
const visibleBorrowItemsRef: { current: any[] } = { current: [borrowed] };
function borrowAction(currentUserId: string) {
  return callback("returnBorrowItem", { isBorrowReturnOwner, visibleBorrowItems: [...visibleBorrowItemsRef.current], visibleBorrowItemsRef, currentUserId, householdId: "home", isHost: false, roommates: [], track, setPrivateBorrowItems: () => {}, setBorrowItems: () => {}, persistPrivateBorrowItem: () => {} });
}
events.length = 0;
const request = borrowAction("borrower");
assert.equal(request("borrow"), true);
assert.equal(request("borrow"), false);
assert.deepEqual(names(), ["borrowingReturnRequested"], "borrower request is not confirmed return");
assert.equal(visibleBorrowItemsRef.current[0].returned, false);
const confirm = borrowAction("owner");
assert.equal(confirm("borrow"), true);
assert.equal(visibleBorrowItemsRef.current[0].returned, true);
assert.equal(confirm("borrow"), false, "a duplicate press on the old Confirm button must not undo");
const undo = borrowAction("owner");
assert.equal(undo("borrow"), true);
assert.equal(undo("borrow"), false, "a duplicate press on the old Undo button must not return again");
assert.deepEqual(names(), ["borrowingReturnRequested", "borrowingItemReturned", "borrowingReturnUndone"]);
assert.equal(visibleBorrowItemsRef.current[0].returned, false);
let failProposal = false;
const propose = callback("proposeChart", { householdId: "home", supabase: { rpc: async () => ({ data: "chart", error: failProposal ? new Error("failed") : null }) }, track, analyticsCountBucket: (count: number) => count === 0 ? "0" : "1_5", reportSupabaseError: () => {}, refreshChartStateRef: { current: async () => {} } });
events.length = 0;
assert.equal(await propose({ generatedTasks: [{ id: "private-title" }] }), "chart");
assert.deepEqual(names(), ["chorePlanCreated"]);
assert.equal(events[0].properties?.chore_count_bucket, "1_5");
assert(!JSON.stringify(events).includes("private-title"), "task contents must stay out of analytics");
failProposal = true;
await assert.rejects(() => propose({ generatedTasks: [] }));
assert.equal(events.length, 1, "failed writes do not count as created charts");
// A shortlist success acknowledgement must wait for both parent and child writes.
// Exercise the actual context callback, including retry and household-switch guards.
const shortlistListsRef = { current: [] as any[] }, shortlistItemsRef = { current: [] as any[] };
const transferOrder: string[] = [];
let releaseParent!: () => void;
let parentBarrier = new Promise<void>(resolve => { releaseParent = resolve; });
let rejectItems = false;
const activeSetupHouseholdRef = { current: "home" };
let essentialId = 0;
const transfer = callback("addSelectedEssentialsToShopping", {
  householdId: "home", currentUserId: "a", shoppingListsRef: shortlistListsRef, shoppingItemsRef: shortlistItemsRef,
  shoppingListsTableReadyRef: { current: true, flush: async () => { transferOrder.push("lists"); await parentBarrier; } },
  shoppingItemsTableReadyRef: { current: true, flush: async () => { transferOrder.push("items"); if (rejectItems) throw new Error("offline"); } },
  activeSetupHouseholdRef, transferEssentialsToShopping, withShoppingOrder,
  ESSENTIAL_CATALOG: [{ id: "kitchen", title: "Kitchen", items: [{ id: "kettle", label: "Kettle" }] }],
  makeId: () => `essential-${++essentialId}`, recordShoppingVersions: () => {},
  setShoppingLists: () => {}, setShoppingItems: () => {}, track, analyticsCountBucket: String,
});
events.length = 0;
let acknowledged = false;
const pendingTransfer = transfer({ kitchen: { kettle: true } }).then((result: any) => { acknowledged = true; return result; });
await Promise.resolve();
assert.equal(acknowledged, false, "optimistic state is not a save acknowledgement");
assert.deepEqual(transferOrder, ["lists"], "items wait for their parent list");
assert.equal(events.length, 0);
releaseParent();
assert.equal((await pendingTransfer).itemsAdded, 1);
assert.deepEqual(transferOrder, ["lists", "items"]);
assert.deepEqual(names(), ["shortlistSentToShopping"]);
rejectItems = true;
await assert.rejects(() => transfer({ kitchen: { kettle: true } }), /offline/);
assert.equal(events.length, 1, "failed persistence never emits a success event");
rejectItems = false;
assert.equal((await transfer({ kitchen: { kettle: true } })).itemsAlreadyActive, 1);
assert.equal(shortlistItemsRef.current.length, 1, "retry flushes existing optimistic intent without duplicating it");
activeSetupHouseholdRef.current = "another-home";
await assert.rejects(() => transfer({ kitchen: { kettle: true } }), /household changed/);
console.log("analytics action transition and shortlist acknowledgement tests passed");

// Execute the actual confirmed expense-create callback with mixed-author items.
const contentAttempts: Array<{ kind: string; source: string; labels: string[]; sent: boolean }> = [];
let saveExpenseFails = false;
const createExpense = callback("addExpense", {
  householdId: "home", session: { user: { id: "a" } }, currentUserId: "a", roommates: [{ id: "a" }, { id: "b" }],
  canonicalExpense, allExpenseSharesPaid, makeId: () => "expense-new",
  shoppingItemsRef: { current: [{ id: "mine", name: "My detergent", addedBy: "a" }, { id: "peer", name: "Peer private item", addedBy: "b" }] },
  prepareItemNameAnalytics: (kind: string, source: string, labels: string[]) => { const attempt = { kind, source, labels: [...labels], sent: false }; contentAttempts.push(attempt); return () => { attempt.sent = true; }; },
  mutateExpense: async () => { if (saveExpenseFails) throw Error("save failed"); return { id: "expense-new" }; },
});
const expenseInput = { title: "My expense", amount: 10, paidBy: "a", sharedWith: ["a", "b"], splits: { a: 5, b: 5 }, date: "2026-11-26", category: "groceries", settled: false };
await createExpense(expenseInput);
assert.deepEqual(contentAttempts.at(-1), { kind: "expense", source: "manual", labels: ["My expense"], sent: true });
await createExpense({ ...expenseInput, title: "Shared list title", shoppingSource: { householdId: "home", shoppingItemIds: ["mine", "peer"] } });
assert.deepEqual(contentAttempts.at(-1)?.labels, ["My detergent"], "peer-authored items and shared list titles must not piggyback on one person's consent");
saveExpenseFails = true;
await assert.rejects(() => createExpense(expenseInput));
assert.equal(contentAttempts.at(-1)?.sent, false, "expense names must not be reported after a failed confirmed save");
console.log("Expense name acknowledgement and peer-author exclusion passed");

const shoppingNameAttempts: string[] = [];
let shoppingSaveFails = false, shoppingSequence = 0;
const addItemWithNames = callback("addShoppingItem", {
  session: { user: { id: "a" } }, householdId: "home", currentUserId: "a",
  activeUserIdRef: { current: "a" }, activeSetupHouseholdRef: { current: "home" },
  shoppingListsRef: { current: [{ id: "list", name: "List" }] }, shoppingItemsRef: { current: [] },
  shoppingListsTableReadyRef: { current: true, flush: async () => {} },
  shoppingItemsTableReadyRef: { current: true, flush: async () => { if (shoppingSaveFails) throw Error("offline"); } },
  makeId: () => `new-item-${++shoppingSequence}`, recordShoppingVersions: () => {}, withShoppingOrder,
  setShoppingItems: () => {}, track,
  prepareItemNameAnalytics: (_kind: string, _source: string, labels: string[]) => () => { shoppingNameAttempts.push(...labels); },
});
await addItemWithNames({ name: "Own item", addedBy: "a", listId: "list" });
await addItemWithNames({ name: "Peer-authored item", addedBy: "b", listId: "list" });
shoppingSaveFails = true;
await assert.rejects(() => addItemWithNames({ name: "Failed own item", addedBy: "a", listId: "list" }), /offline/);
assert.deepEqual(shoppingNameAttempts, ["Own item"], "manual shopping capture requires acknowledgement and guards the declared author");
