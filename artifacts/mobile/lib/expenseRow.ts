import type { Expense } from "../context/AppContext.ts";

export type ExpenseRow = {
  id: string;
  household_id: string;
  paid_by: string;
  creator_id: string | null;
  amount_cents: number;
  expense_date: string;
  settled: boolean;
  entry: Expense;
  created_at: string;
  updated_at: string;
};

export function expenseToRow(expense: Expense, householdId: string): ExpenseRow {
  const now = expense.updatedAt ?? expense.createdAt ?? new Date().toISOString();
  return {
    id: expense.id,
    household_id: householdId,
    paid_by: expense.paidBy,
    creator_id: expense.creatorId ?? null,
    amount_cents: expense.amountCents ?? Math.round(expense.amount * 100),
    expense_date: expense.date,
    settled: expense.settled,
    entry: expense,
    created_at: expense.createdAt ?? now,
    updated_at: now,
  };
}

export function rowToExpense(row: ExpenseRow): Expense {
  return {
    ...row.entry,
    id: row.id,
    paidBy: row.paid_by,
    creatorId: row.creator_id ?? undefined,
    amountCents: row.amount_cents,
    amount: row.amount_cents / 100,
    date: row.expense_date,
    settled: row.settled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
