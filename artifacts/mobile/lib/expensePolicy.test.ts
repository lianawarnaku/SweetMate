import assert from "node:assert/strict";
import type { Expense } from "../context/AppContext.ts";
import {
  allExpenseSharesPaid, canEditExpense, canManageExpense, canonicalExpense,
  expenseFinancialSignature, expenseShareCents, hasExpensePayments,
  expensePaidCents, expenseRemainingCents, expenseOutstandingCents,
} from "./expensePolicy.ts";

const active = new Set(["creator", "payer", "debtor", "zero", "host"]);
const base: Expense = {
  id: "expense", title: "Dinner", amount: 12.01, amountCents: 1201,
  creatorId: "creator", paidBy: "payer", sharedWith: ["payer", "debtor", "zero"],
  splits: { payer: 6, debtor: 6.01, zero: 0 }, allocations: [
    { participantId: "payer", amountCents: 600 },
    { participantId: "debtor", amountCents: 601 },
    { participantId: "zero", amountCents: 0 },
  ], date: "2026-11-08", category: "other", settled: false,
};
for (const actor of ["creator", "payer", "debtor", "host", "", "outsider"]) {
  assert.equal(canEditExpense(base, actor), actor === "creator", `creator-only edit: ${actor}`);
  assert.equal(canManageExpense(base, actor, actor === "host"), ["creator", "payer", "host"].includes(actor), `manager: ${actor}`);
  assert.equal(canEditExpense({ ...base, creatorId: undefined }, actor), actor === "payer", `legacy edit: ${actor}`);
}
assert.equal(canManageExpense(base, "", true), false, "a missing actor is not authorized by host UI state");

const canonical = canonicalExpense(base, active);
assert.deepEqual(canonical, base);
assert.notEqual(canonical.allocations, base.allocations, "canonicalization does not expose the input allocation array");
const legacy = { ...base, allocations: undefined, amountCents: undefined, date: "2026-11-08T12:00:00.000Z" };
assert.deepEqual(canonicalExpense(legacy, active), base, "legacy dollar shares normalize to exact cent allocations and date-only storage");
assert.throws(() => canonicalExpense({ ...base, amount: 13 }, active), /total/);
assert.throws(() => canonicalExpense({ ...base, amountCents: 1200 }, active), /total/);
assert.throws(() => canonicalExpense({ ...base, amount: 12.011 }, active), /decimal/);
assert.throws(() => canonicalExpense({ ...base, splits: { payer: 6, debtor: 1000000, zero: 0 } }, active), /agree/);
assert.throws(() => canonicalExpense({ ...base, sharedWith: ["payer", "debtor", "debtor"] }, active), /unique/);
assert.throws(() => canonicalExpense({ ...base, paidBy: "inactive" }, active), /active/);
assert.throws(() => canonicalExpense({ ...base, sharedWith: ["payer", "inactive", "zero"] }, active), /active/);
assert.throws(() => canonicalExpense({ ...base, allocations: [
  { participantId: "payer", amountCents: 600 }, { participantId: "debtor", amountCents: 600 }, { participantId: "zero", amountCents: 0 },
] }, active), /full expense/);
assert.throws(() => canonicalExpense({ ...base, allocations: [
  { participantId: "payer", amountCents: 600 }, { participantId: "debtor", amountCents: 601.1 }, { participantId: "zero", amountCents: 0 },
] }, active), /full expense/);
assert.throws(() => canonicalExpense({ ...base, allocations: [
  { participantId: "payer", amountCents: 600 }, { participantId: "debtor", amountCents: 601 }, { participantId: "debtor", amountCents: 0 },
] }, active), /full expense/);
assert.throws(() => canonicalExpense({ ...base, date: "2026-02-30" }, active), /date/);

assert.equal(hasExpensePayments(base), false);
assert.equal(hasExpensePayments({ ...base, paidBack: { debtor: true } }), true);
assert.equal(hasExpensePayments({ ...base, settled: true }), true);
assert.equal(hasExpensePayments({ ...base, paidBack: { zero: true } }), true, "legacy paid flags conservatively lock financial edits");
assert.equal(allExpenseSharesPaid(base), false);
assert.equal(allExpenseSharesPaid({ ...base, paidBack: { debtor: true } }), true, "$0 and payer shares do not block settlement");
assert.equal(allExpenseSharesPaid({ ...base, allocations: undefined, paidBack: { debtor: true } }), true, "legacy shares receive the same rule");
assert.equal(allExpenseSharesPaid({ ...base, paidBy: "debtor", splits: { debtor: 12.01 }, allocations: [{ participantId: "debtor", amountCents: 1201 }] }), true);
assert.equal(expenseShareCents({ ...base, splits: { debtor: 1000000 } }, "debtor"), 601, "the cent allocation is authoritative for balances");

const paid = { ...base, paidBack: { debtor: true } };
const signature = expenseFinancialSignature(paid);
assert.equal(expenseFinancialSignature({ ...paid, title: "Dinner corrected", notes: "Receipt", category: "groceries" }), signature, "descriptive edits are safe after payment");
assert.equal(expenseFinancialSignature({ ...paid, sharedWith: [...paid.sharedWith].reverse(), allocations: [...paid.allocations!].reverse() }), signature, "participant order is not a financial change");
for (const changed of [
  { ...paid, amount: 20, amountCents: 2000 },
  { ...paid, amount: 20 },
  { ...paid, splits: { payer: 0, debtor: 12.01, zero: 0 } },
  { ...paid, paidBy: "debtor" },
  { ...paid, date: "2026-11-09" },
  { ...paid, sharedWith: ["payer", "debtor"] },
  { ...paid, allocations: [{ participantId: "payer", amountCents: 601 }, { participantId: "debtor", amountCents: 600 }, { participantId: "zero", amountCents: 0 }] },
  { ...paid, shoppingSource: { type: "shopping-item" as const, householdId: "home", shoppingListId: "list", shoppingListName: "Groceries", shoppingItemIds: ["item"] } },
]) assert.notEqual(expenseFinancialSignature(changed), signature, "paid financial changes must be detected");
console.log("expense policy tests passed");

const partial = { ...base, repaymentCents: { debtor: 200 }, paidBack: { debtor: true } };
assert.equal(expensePaidCents(partial, "debtor"), 200);
assert.equal(expenseRemainingCents(partial, "debtor"), 401, "partial payments subtract integer cents without rounding a dollar remainder");
assert.equal(expenseOutstandingCents(partial, "debtor"), 401);
assert.equal(allExpenseSharesPaid(partial), false, "a stale legacy paid flag cannot override an authoritative partial repayment");
assert.equal(hasExpensePayments(partial), true, "even a partial repayment protects the financial terms");
assert.equal(expensePaidCents({ ...base, paidBack: { debtor: true } }, "debtor"), 601, "legacy full-repayment flags retain their meaning");
assert.equal(expensePaidCents({ ...base, repaymentCents: {}, paidBack: { debtor: true } }, "debtor"), 0, "an existing cent map is authoritative, including a missing participant");
assert.equal(expensePaidCents({ ...base, repaymentCents: null, paidBack: { debtor: true } }, "debtor"), 601, "nullable old optional fields use the legacy fallback");
assert.equal(expensePaidCents({ ...partial, repaymentCents: { payer: 600, debtor: 200 } }, "payer"), 0, "a payer's own allocation is never a repayment");
assert.equal(expenseRemainingCents(partial, "payer"), 0);
assert.equal(expenseRemainingCents(partial, "unrelated"), 0);
assert.equal(expenseOutstandingCents(partial, "zero"), 0);
for (const cents of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  assert.equal(expensePaidCents({ ...base, repaymentCents: { debtor: cents } }, "debtor"), 0, "malformed cent totals cannot poison a balance");
}
assert.equal(expenseRemainingCents({ ...base, repaymentCents: { debtor: 700 } }, "debtor"), 0, "an over-recorded amount cannot create negative debt");
const full = { ...base, repaymentCents: { debtor: 601 }, paidBack: {} };
assert.equal(allExpenseSharesPaid(full), true, "cent totals establish full repayment without requiring legacy flags or zero-share acknowledgements");
const manuallySettled = { ...partial, settled: true, manuallySettled: true };
assert.equal(expenseRemainingCents(manuallySettled, "debtor"), 401, "manual settlement preserves raw payment accounting for reopening");
assert.equal(expenseOutstandingCents(manuallySettled, "debtor"), 0);
assert.equal(allExpenseSharesPaid(manuallySettled), false, "settled does not assert that every share was actually recorded as paid");
assert.equal(expenseOutstandingCents({ ...partial, voidedAt: "2026-11-09T12:00:00Z" }, "debtor"), 0);
assert.equal(expenseRemainingCents({ ...partial, voidedAt: "2026-11-09T12:00:00Z" }, "debtor"), 401, "voiding retains the historical amount and repayments");
const reversed = { ...base, repaymentCents: { debtor: 0 }, paidBack: {}, repayments: [
  { id: "repayment", actorId: "debtor", amountCents: 200, recordedAt: "2026-11-08T12:00:00Z", reversedAt: "2026-11-08T13:00:00Z" },
] };
assert.equal(expenseOutstandingCents(reversed, "debtor"), 601, "reversing a repayment restores its debt");
assert.equal(hasExpensePayments(reversed), true, "reversed payments still protect financial history");
assert.equal(hasExpensePayments({ ...base, financialHistory: true }), true);
assert.equal(hasExpensePayments({ ...base, manuallySettled: true }), true);
assert.equal(hasExpensePayments({ ...base, voidedAt: "2026-11-09T12:00:00Z" }), true);
assert.equal(expenseFinancialSignature(partial), expenseFinancialSignature(base), "repayment amounts are facts, not edited financial terms");
console.log("expense partial repayment, reversal and void policy tests passed");
