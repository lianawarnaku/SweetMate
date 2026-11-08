import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expenseRemainingCents } from "./expensePolicy.ts";
import { normalizeExpenseDate } from "./expenseDate.ts";
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
runInNewContext(ts.transpileModule(`exports.ack = ${acknowledgement.getText(hookParsed)}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: ackExports, track, scopeRef: { current: "test" }, scope: "test", effectActive: true, loadActivity: async () => {} });
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
