import assert from "node:assert/strict";
import type { Expense } from "../context/AppContext.ts";
import {
  allExpenseSharesPaid, canEditExpense, canManageExpense, canonicalExpense,
  expenseFinancialSignature, expenseShareCents, hasExpensePayments,
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
