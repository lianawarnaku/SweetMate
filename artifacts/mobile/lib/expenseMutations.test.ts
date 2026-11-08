import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { Expense } from "../context/AppContext.ts";
import { canEditExpense, canManageExpense, canonicalExpense, expenseFinancialSignature, expensePaidCents, expenseRemainingCents, hasExpensePayments } from "./expensePolicy.ts";
import { normalizeExpenseDate } from "./expenseDate.ts";
import { summarizeMemberIous } from "./iouSummary.ts";
import { expenseToRow, rowToExpense } from "./expenseRow.ts";

// Execute the actual domain/hook callbacks; no React or live account is needed.
function sourceFile(path: string) {
  return ts.createSourceFile(path, readFileSync(resolve(process.cwd(), path), "utf8"), ts.ScriptTarget.Latest, true, path.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
const contextSource = sourceFile("context/AppContext.tsx");
const hookSource = sourceFile("hooks/useExpenseSync.ts");
function callback(parsed: ts.SourceFile, name: string, bindings: Record<string, unknown>): (...args: any[]) => any {
  let expression: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      expression = ts.isCallExpression(node.initializer) && node.initializer.expression.getText(parsed) === "useCallback"
        ? node.initializer.arguments[0] : node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert(expression, `missing real callback ${name}`);
  const exports: { action?: (...args: any[]) => any } = {};
  runInNewContext(ts.transpileModule(`exports.action = ${expression.getText(parsed)};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { Error, Set, ...bindings, exports });
  return exports.action!;
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const expense: Expense = {
  id: "expense", title: "Groceries", amount: 12.01, amountCents: 1201, category: "groceries",
  paidBy: "payer", creatorId: "a", sharedWith: ["payer", "a", "b", "zero"],
  allocations: [{ participantId: "payer", amountCents: 200 }, { participantId: "a", amountCents: 601 }, { participantId: "b", amountCents: 400 }, { participantId: "zero", amountCents: 0 }],
  splits: { payer: 2, a: 6.01, b: 4, zero: 0 }, date: "2026-11-08", settled: false,
  repaymentCents: { a: 200, b: 100 }, paidBack: { a: true }, financialHistory: true,
  repayments: [
    { id: "own", actorId: "a", amountCents: 200, recordedAt: "2026-11-08T12:00:00Z" },
    { id: "other", actorId: "b", amountCents: 100, recordedAt: "2026-11-08T12:00:00Z" },
    { id: "reversed", actorId: "a", amountCents: 50, recordedAt: "2026-11-08T12:00:00Z", reversedAt: "2026-11-08T13:00:00Z" },
  ], version: 7,
};
function mutationFixture(actorId = "a", isHost = false) {
  const expensesRef = { current: [copy(expense)] };
  const calls: unknown[][] = [];
  let write: () => Promise<void> = async () => {};
  const bindings = {
    expensesRef, currentUserId: actorId, expenseRemainingCents, expensePaidCents, normalizeExpenseDate,
    canManageExpense: (value: Expense) => canManageExpense(value, actorId, isHost),
    mutateExpense: async (...args: unknown[]) => { calls.push(copy(args)); await write(); return {}; },
  };
  return {
    expensesRef, calls,
    mark: callback(contextSource, "markPersonPaid", bindings),
    undo: callback(contextSource, "undoPersonPaid", bindings),
    void: callback(contextSource, "deleteExpense", bindings),
    restore: callback(contextSource, "restoreExpense", bindings),
    set write(value: () => Promise<void>) { write = value; },
  };
}

// Own, positive, bounded integer-cent repayments with date-only storage.
{
  const f = mutationFixture();
  assert.equal(await f.mark("expense", "a", 101, "2026-11-07"), true);
  assert.deepEqual(f.calls, [["repay", "expense", { amountCents: 101, date: "2026-11-07" }]]);
  assert.equal(f.expensesRef.current[0].repaymentCents?.a, 200, "the domain does not invent a local acknowledgement before sync commits");
  await assert.rejects(f.mark("expense", "b", 100), /own repayment/);
  await assert.rejects(f.mark("missing", "a", 100), /own repayment/);
  assert.equal(f.calls.length, 1);
}
for (const invalid of [0, -1, 0.5, 402, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  const f = mutationFixture();
  await assert.rejects(f.mark("expense", "a", invalid), /positive repayment/);
  assert.equal(f.calls.length, 0);
}
for (const invalid of ["", "2026-02-30", "11/08/2026", "2026-11-08T12:00:00Z"]) {
  const f = mutationFixture();
  await assert.rejects(f.mark("expense", "a", 100, invalid), /YYYY-MM-DD/);
  assert.equal(f.calls.length, 0);
}
{
  const f = mutationFixture();
  await f.mark("expense", "a");
  assert.deepEqual(f.calls[0], ["repay", "expense", { amountCents: 401 }], "older callers without an amount record exactly the current remainder");
  f.expensesRef.current[0] = { ...f.expensesRef.current[0], repaymentCents: undefined, paidBack: {} };
  await f.mark("expense", "a");
  assert.deepEqual(f.calls[1], ["repay", "expense", { amountCents: 601 }], "legacy boolean-only unpaid records remain compatible");
  f.expensesRef.current[0].paidBack = { a: true };
  assert.equal(await f.mark("expense", "a"), false);
  assert.equal(f.calls.length, 2);
}
for (const patch of [{ settled: true }, { voidedAt: "2026-11-09T12:00:00Z" }, { repaymentCents: { a: 601 } }]) {
  const f = mutationFixture(); f.expensesRef.current[0] = { ...expense, ...patch };
  assert.equal(await f.mark("expense", "a", 1), false);
  assert.equal(f.calls.length, 0);
}
for (const actor of ["payer", "zero"]) {
  const f = mutationFixture(actor);
  assert.equal(await f.mark("expense", actor, 1), false);
  assert.equal(f.calls.length, 0);
}
{
  const f = mutationFixture();
  f.write = async () => { throw new Error("No server acknowledgement"); };
  await assert.rejects(f.mark("expense", "a", 100), /acknowledgement/);
  assert.equal(f.expensesRef.current[0].repaymentCents?.a, 200);
}

// Specific reversals belong to the actor and preserve manual settlement rules.
{
  const f = mutationFixture();
  assert.equal(await f.undo("expense", "own"), true);
  assert.deepEqual(f.calls[0], ["undo_repay", "expense", { paymentId: "own" }]);
  for (const id of ["other", "reversed", "missing"]) await assert.rejects(f.undo("expense", id), /own recorded repayments/);
  assert.equal(f.calls.length, 1);
  assert.equal(await f.undo("expense"), true, "omitted payment ID selects and freezes the latest own repayment before queuing");
  assert.deepEqual(f.calls[1], ["undo_repay", "expense", { paymentId: "own" }]);
}
{
  const f = mutationFixture();
  f.expensesRef.current[0] = { ...expense, manuallySettled: true, settled: true };
  await assert.rejects(f.undo("expense", "own"), /reopen it/);
  assert.equal(f.calls.length, 0);
  f.expensesRef.current[0] = { ...expense, voidedAt: "2026-11-09T12:00:00Z" };
  assert.equal(await f.undo("expense", "own"), false);
  f.expensesRef.current[0] = { ...expense, repaymentCents: {}, paidBack: { a: true } };
  assert.equal(await f.undo("expense", "own"), false, "authoritative zero paid cents cannot be overridden by an old paid flag");
}

// Voiding/restoring is explicitly versioned and uses the same manager policy.
for (const [actor, host, allowed] of [["a", false, true], ["payer", false, true], ["host", true, true], ["b", false, false]] as const) {
  const f = mutationFixture(actor, host);
  if (!allowed) {
    await assert.rejects(f.void("expense"), /can’t void/);
    f.expensesRef.current[0] = { ...expense, voidedAt: "2026-11-09T12:00:00Z", version: 8 };
    await assert.rejects(f.restore("expense"), /can’t restore/);
    assert.equal(f.calls.length, 0);
    continue;
  }
  assert.equal(await f.restore("expense"), false);
  assert.equal(await f.void("expense"), true);
  assert.deepEqual(f.calls[0], ["delete", "expense", {}, 7]);
  f.expensesRef.current[0] = { ...expense, voidedAt: "2026-11-09T12:00:00Z", version: 8 };
  assert.equal(await f.void("expense"), false);
  assert.equal(await f.restore("expense"), true);
  assert.deepEqual(f.calls[1], ["restore", "expense", {}, 8]);
}

// A form's captured version cannot silently rebase onto a newer Realtime row.
{
  const expensesRef = { current: [copy(expense)] };
  const calls: unknown[][] = [];
  const update = callback(contextSource, "updateExpense", {
    expensesRef, householdId: "home", roommates: expense.sharedWith.map(id => ({ id })),
    canEditExpense: (value: Expense) => canEditExpense(value, "a"),
    expenseFinancialSignature, hasExpensePayments, canonicalExpense,
    mutateExpense: async (...args: unknown[]) => { calls.push(copy(args)); },
  });
  await assert.rejects(update("expense", { version: 6, title: "Stale editor title" }), /changed while you were editing/);
  assert.equal(calls.length, 0, "a known stale form must not issue any RPC");
  assert.equal(await update("expense", {
    version: 7, title: "Reviewed title", category: "other", notes: "Reviewed note",
    creatorId: "different-user", createdAt: "2000-01-01", repaymentCents: {}, paidBack: {}, financialHistory: false,
  }), true);
  assert.deepEqual(calls[0], ["update", "expense", { title: "Reviewed title", category: "other", notes: "Reviewed note" }, 7],
    "a matching form version sends only descriptive fields and uses the current server version as its concurrency precondition");
  assert.equal(expensesRef.current[0].repaymentCents?.a, 200);
  assert.equal(expensesRef.current[0].creatorId, "a");
  expensesRef.current[0] = { ...expensesRef.current[0], version: 8, title: "Changed on another device" };
  await assert.rejects(update("expense", { version: 7, title: "Old form still open" }), /changed while you were editing/);
  assert.equal(calls.length, 1, "a Realtime update cannot silently replace the form's original concurrency version");
}

// Real account balances keep partial debts zero-sum, include former members,
// and exclude voided/manual settlements without altering stored payment facts.
{
  const expenses: Expense[] = [copy(expense),
    { ...expense, id: "reverse-direction", paidBy: "a", sharedWith: ["payer"], splits: { payer: 5.01 }, allocations: [{ participantId: "payer", amountCents: 501 }], amount: 5.01, amountCents: 501, repaymentCents: { payer: 101 } },
    { ...expense, id: "void", paidBy: "b", sharedWith: ["payer"], splits: { payer: 100 }, allocations: [{ participantId: "payer", amountCents: 10000 }], voidedAt: "2026-11-09T12:00:00Z" },
    { ...expense, id: "manual", paidBy: "a", sharedWith: ["b"], splits: { b: 7 }, allocations: [{ participantId: "b", amountCents: 700 }], settled: true, manuallySettled: true },
    { ...expense, id: "former", sharedWith: ["former"], splits: { former: 3 }, allocations: [{ participantId: "former", amountCents: 300 }], amount: 3, amountCents: 300, repaymentCents: { former: 100 } },
  ];
  const before = JSON.stringify(expenses);
  const balances = callback(contextSource, "getBalances", { expenses, roommates: [{ id: "payer" }, { id: "a" }, { id: "b" }], summarizeMemberIous })();
  assert.equal(balances.payer, 5.01);
  assert.equal(balances.a, -0.01);
  assert.equal(balances.b, -3);
  assert.equal(balances.former, -2);
  assert.equal(Object.values(balances).reduce((sum: number, amount) => sum + Math.round((amount as number) * 100), 0), 0);
  assert.equal(JSON.stringify(expenses), before);
}

// An old household callback must never submit through a newer household engine,
// even during the render-to-effect-cleanup interval when refs already changed.
for (const nextEngineScope of ["user:A", "user:B"]) {
  const calls: unknown[][] = [];
  const oldMutate = callback(hookSource, "mutate", {
    scope: "user:A", scopeRef: { current: "user:B" }, engineScopeRef: { current: nextEngineScope },
    engineRef: { current: { submit: async (...args: unknown[]) => { calls.push(args); return {}; } } },
  });
  await assert.rejects(oldMutate("repay", "expense", { amountCents: 100 }), /Sweet.*(?:changed|loading)/i);
  assert.equal(calls.length, 0);
}
{
  const calls: unknown[][] = [];
  const currentMutate = callback(hookSource, "mutate", {
    scope: "user:B", scopeRef: { current: "user:B" }, engineScopeRef: { current: "user:B" },
    engineRef: { current: { submit: async (...args: unknown[]) => { calls.push(copy(args)); return { id: "expense" }; } } },
  });
  assert.equal((await currentMutate("repay", "expense", { amountCents: 100, date: "2026-11-07" })).id, "expense");
  assert.deepEqual(calls[0], ["repay", "expense", { amountCents: 100, date: "2026-11-07" }, null]);
}

function recoveryFixture(payload: Record<string, unknown> = {}) {
  let current: Expense | null = copy(expense);
  let stale = false;
  const engine = {
    refresh: async () => {}, get state() { return { ready: true, stale }; },
    failedOperation: () => ({ operationId: "failed", action: "update", expenseId: "expense", payload }),
    currentExpense: () => current ? expenseToRow(current, "home") : null,
  };
  return {
    recover: callback(hookSource, "recover", { userId: "a", scope: "a:home", scopeRef: { current: "a:home" }, engineScopeRef: { current: "a:home" }, engineRef: { current: engine }, rowToExpense, canEditExpense, hasExpensePayments, expenseFinancialSignature }),
    set current(value: Expense | null) { current = value; }, set stale(value: boolean) { stale = value; },
  };
}
{
  const f = recoveryFixture({ title: "Recovered title", notes: "Saved note", amount: 20, amountCents: 2000, splits: { a: 20 }, allocations: [{ participantId: "a", amountCents: 2000 }] });
  const recovered = await f.recover("failed");
  assert.equal(recovered.expense.title, "Recovered title");
  assert.equal(recovered.expense.notes, "Saved note");
  assert.equal(recovered.expense.amountCents, 1201);
  assert.equal(recovered.expense.repaymentCents.a, 200);
  assert.match(recovered.warning, /Only the saved title/);
}
{
  const f = recoveryFixture({ title: "Recovered safely", repaymentCents: {}, paidBack: {}, repayments: [], financialHistory: false, settled: true, voidedAt: "unexpected", version: 1, creatorId: "other",
    createdAt: "2020-01-01", updatedAt: "2020-01-01", shoppingSource: { shoppingListId: "different-list" },
  });
  const source = { type: "shopping-item" as const, householdId: "home", shoppingListId: "list", shoppingListName: "Groceries", shoppingItemIds: ["item"] };
  f.current = { ...expense, shoppingSource: source, createdAt: "2026-11-08T11:00:00Z", updatedAt: "2026-11-08T12:00:00Z" };
  const recovered = await f.recover("failed");
  assert.equal(recovered.expense.title, "Recovered safely");
  assert.deepEqual(recovered.expense.repaymentCents, expense.repaymentCents, "saved draft aliases cannot replace current repayment facts");
  assert.deepEqual(recovered.expense.repayments, expense.repayments);
  assert.equal(recovered.expense.financialHistory, true);
  assert.equal(recovered.expense.settled, false);
  assert.equal(recovered.expense.voidedAt, undefined);
  assert.equal(recovered.expense.creatorId, "a");
  assert.equal(recovered.expense.version, 7);
  assert.deepEqual(recovered.expense.shoppingSource, source, "recovery preserves immutable authoritative Shopping identity");
  assert.equal(recovered.expense.createdAt, "2026-11-08T11:00:00Z");
  assert.equal(recovered.expense.updatedAt, "2026-11-08T12:00:00Z");
}
{
  const f = recoveryFixture({ title: "Recovered latest", version: 2 });
  f.current = { ...expense, version: 19 };
  const recovered = await f.recover("failed");
  assert.equal(recovered.expense.version, 19, "a recovered failed edit captures the latest authoritative server version, never the failed form's older version");
}
{
  const f = recoveryFixture({ title: "Saved" });
  f.stale = true; await assert.rejects(f.recover("failed"), /Connect to refresh/);
  f.stale = false; f.current = null; await assert.rejects(f.recover("failed"), /no longer available/);
  f.current = { ...expense, voidedAt: "2026-11-09T12:00:00Z" }; await assert.rejects(f.recover("failed"), /Restore this voided/);
  f.current = { ...expense, creatorId: "other" }; await assert.rejects(f.recover("failed"), /Only the expense creator/);
}
console.log("actual expense partial repayment, reversal, void, balances, recovery and household-scope callback tests passed");
