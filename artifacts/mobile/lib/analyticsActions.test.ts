import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { setShoppingCompletion } from "./shoppingCompletion.ts";

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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: { callback?: (...args: any[]) => any } = {};
  runInNewContext(compiled, { exports, ...bindings });
  return exports.callback!;
}
const events: { event: string; properties?: Record<string, unknown> }[] = [];
const track = new Proxy({}, { get: (_target, event: string) => (properties?: Record<string, unknown>) => events.push({ event, properties }) });
const names = () => events.map((event) => event.event);
const expense = { id: "expense", paidBy: "payer", settled: false, splits: { payer: 2, a: 2, b: 2 } };
const expensesRef: { current: any[] } = { current: [expense] };
const setExpenses = (next: any[] | ((previous: any[]) => any[])) => {
  expensesRef.current = typeof next === "function" ? next(expensesRef.current) : next;
};
const markPaid = callback("markPersonPaid", { expensesRef, setExpenses, track });
markPaid("expense", "payer");
markPaid("expense", "unknown");
assert.equal(events.length, 0, "payer/nonexistent shares are not repayments");
markPaid("expense", "a");
markPaid("expense", "a");
assert.deepEqual(names(), ["expenseRepaymentRecorded"], "duplicate repayment counts once");
assert.equal(events[0].properties?.settles_expense, false);
assert.equal(expensesRef.current[0].settled, false);
markPaid("expense", "b");
assert.deepEqual(names(), ["expenseRepaymentRecorded", "expenseRepaymentRecorded", "iouSettled"]);
assert.equal(events[1].properties?.settles_expense, true);
assert.equal(events[2].properties?.source, "repayment");
assert.equal(expensesRef.current[0].settled, true);
assert(expensesRef.current[0].updatedAt, "repayment changes need a sync timestamp");
markPaid("expense", "b");
assert.equal(events.length, 3, "settled repeats do not count again");
const settle = callback("settleExpense", { expensesRef, setExpenses, track, canManageExpense: () => true });
assert.equal(settle("expense"), false);
expensesRef.current = [{ ...expense }];
events.length = 0;
assert.equal(settle("expense"), true);
assert.equal(settle("expense"), false);
assert.deepEqual(names(), ["iouSettled"], "manual settlement only counts the first transition");
assert.equal(events[0].properties?.source, "manual");
const queuedRef = { current: [{ ...expense }] };
let queuedState: any[] = [{ ...expense, notes: "pending edit" }, { id: "pending-new-expense" }];
const queuedSettle = callback("settleExpense", {
  expensesRef: queuedRef, track, canManageExpense: () => true,
  setExpenses: (update: (previous: any[]) => any[]) => { queuedState = update(queuedState); },
});
assert.equal(queuedSettle("expense"), true);
assert.equal(queuedState[0].notes, "pending edit", "settlement preserves an already queued edit");
assert.equal(queuedState[1].id, "pending-new-expense", "settlement preserves another queued expense creation");
const forbiddenSettle = callback("settleExpense", {
  expensesRef: { current: [{ ...expense }] }, setExpenses: () => assert.fail("unauthorized mutation"),
  track, canManageExpense: () => false,
});
const beforeForbidden = events.length;
assert.equal(forbiddenSettle("expense"), false);
assert.equal(events.length, beforeForbidden, "existing settlement permissions remain enforced");
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
  return callback("returnBorrowItem", { visibleBorrowItems: [...visibleBorrowItemsRef.current], visibleBorrowItemsRef, currentUserId, householdId: "home", isHost: false, roommates: [], track, setPrivateBorrowItems: () => {}, setBorrowItems: () => {}, persistPrivateBorrowItem: () => {} });
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
console.log("analytics action transition tests passed");
