import type { Expense } from "../context/AppContext.ts";
import { expenseToRow, rowToExpense } from "./expenseRow.ts";
import { applyNormalizedEvent, planNormalizedSync } from "./normalizedCollection.ts";

function assert(value: boolean, message: string) { if (!value) throw new Error(message); }
const expense: Expense = {
  id: "expense-1", title: "Utilities", amount: 42.5, amountCents: 4250,
  paidBy: "user-1", sharedWith: ["user-2"], splits: { "user-2": 42.5 },
  date: "2026-08-27", category: "utilities", settled: false,
  creatorId: "user-1", notes: "August", createdAt: "2026-08-27T10:00:00.000Z",
  updatedAt: "2026-08-27T10:00:00.000Z",
};
const row = expenseToRow(expense, "home-1");
assert(JSON.stringify(rowToExpense(row)) === JSON.stringify(expense), "expense rows must round-trip losslessly");
assert(planNormalizedSync([expense], new Map([[row.id, row]]), (item) => expenseToRow(item, "home-1")).upserts.length === 0, "unchanged expenses must not be rewritten");
assert(planNormalizedSync([], new Map([[row.id, row]]), (item: Expense) => expenseToRow(item, "home-1")).deleteIds[0] === row.id, "expense deletion must remove its normalized row");
const newer = { ...row, settled: true, entry: { ...expense, settled: true }, updated_at: "2026-08-27T11:00:00.000Z" };
assert(applyNormalizedEvent([expense], "UPDATE", newer, rowToExpense)[0].settled, "newer Realtime expense updates must apply");
const timestampExpense = { ...expense, date: "2026-11-08T00:00:00.000Z" };
const timestampRow = expenseToRow(timestampExpense, "home-1");
assert(timestampRow.expense_date === "2026-11-08", "database dates must be calendar days");
assert(timestampRow.entry.date === "2026-11-08", "the JSON entry and SQL calendar day must agree");
assert(rowToExpense({ ...timestampRow, expense_date: "2026-11-08T00:00:00.000Z" }).date === "2026-11-08", "legacy timestamp rows normalize on read");
assert(rowToExpense({ ...row, amount_cents: 6000, paid_by: "user-2", settled: true }).amount === 60, "SQL financial columns remain authoritative over stale entry JSON");
assert(rowToExpense({ ...row, version: 7, entry: { ...expense, version: 2 } }).version === 7, "SQL version wins over stale JSON for concurrency checks");
assert(expenseToRow({ ...expense, version: 7 }, "home-1").version === 7, "versioned expense rows retain their concurrency version");
assert(!Object.prototype.hasOwnProperty.call(row, "version"), "legacy unversioned rows keep their original shape");
console.log("expense normalized row tests passed");
