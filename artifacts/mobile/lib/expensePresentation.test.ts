import assert from "node:assert/strict";
import { expenseMatchesFilter, expensePersonalLabel, projectExpenseBalances } from "./expensePresentation.ts";
import type { ExpenseBalanceFields } from "./expensePolicy.ts";

const expense: ExpenseBalanceFields = {
  paidBy: "payer", allocations: [
    { participantId: "payer", amountCents: 300 },
    { participantId: "a", amountCents: 601 },
    { participantId: "b", amountCents: 200 },
  ], splits: { payer: 3, a: 1000000, b: 2 }, repaymentCents: { a: 200, b: 200 }, settled: false,
};
assert.equal(expensePersonalLabel(expense, "payer"), "Owed $4.01");
assert.equal(expensePersonalLabel(expense, "a"), "You owe $4.01");
assert.equal(expensePersonalLabel(expense, "b"), "Your share paid");
assert.equal(expensePersonalLabel(expense, "unrelated"), "Household total");
assert.equal(expensePersonalLabel({ ...expense, settled: true }, "a"), "Settled", "manual settlement does not claim that the user paid their share");
assert.equal(expensePersonalLabel({ ...expense, settled: true }, "payer"), "Settled");
assert.equal(expensePersonalLabel({ ...expense, voidedAt: "2026-11-08T12:00:00Z" }, "a"), "Voided");
assert.equal(expensePersonalLabel({ paidBy: "payer", splits: { payer: 10 } }, "payer"), "No repayment due");
assert.equal(expensePersonalLabel({ paidBy: "payer", splits: { a: 0.01 }, repaymentCents: {} }, "a"), "You owe $0.01", "personal labels retain a one-cent remainder");

for (const member of ["payer", "a", "b", "unrelated"]) {
  assert.equal(expenseMatchesFilter(expense, member, "all"), true);
  assert.equal(expenseMatchesFilter(expense, member, "owe"), member === "a");
  assert.equal(expenseMatchesFilter(expense, member, "owed"), member === "payer");
  assert.equal(expenseMatchesFilter({ ...expense, settled: true }, member, "owe"), false);
  assert.equal(expenseMatchesFilter({ ...expense, settled: true }, member, "owed"), false);
  const voided = { ...expense, voidedAt: "2026-11-08T12:00:00Z" };
  assert.equal(expenseMatchesFilter(voided, member, "all"), true, "voided records stay accessible in history");
  assert.equal(expenseMatchesFilter(voided, member, "owe"), false);
  assert.equal(expenseMatchesFilter(voided, member, "owed"), false);
}
assert.equal(projectExpenseBalances([], "a", false), null, "initial loading must never display a false zero balance");
assert.equal(projectExpenseBalances([expense], "a", false), null, "unconfirmed cached data does not establish a current balance");
assert.deepEqual(projectExpenseBalances([], "a", true), { owedCents: 0, owingCents: 0, netCents: 0, hasOutstandingDebts: false });
assert.deepEqual(projectExpenseBalances([expense], "a", true), { owedCents: 0, owingCents: 401, netCents: -401, hasOutstandingDebts: true });
console.log("expense personal labels, outstanding filters and loading projection tests passed");
