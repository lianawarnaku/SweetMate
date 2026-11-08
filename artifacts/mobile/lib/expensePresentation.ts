import {
  expenseOutstandingCents, expensePaidCents, expenseShareCents,
  type ExpenseBalanceFields,
} from "./expensePolicy.ts";
import { summarizeMemberIous, type SummaryExpense } from "./iouSummary.ts";

export type ExpenseFilter = "all" | "owe" | "owed";

function participantIds(expense: ExpenseBalanceFields): string[] {
  return [...new Set(expense.allocations != null
    ? expense.allocations.map((allocation) => allocation.participantId)
    : Object.keys(expense.splits ?? {}))];
}

export function expenseMatchesFilter(expense: ExpenseBalanceFields, memberId: string, filter: ExpenseFilter): boolean {
  // Voided records remain accessible in household history, never in debt filters.
  if (filter === "all") return true;
  if (filter === "owe") return expenseOutstandingCents(expense, memberId) > 0;
  return expense.paidBy === memberId && participantIds(expense).some((id) => expenseOutstandingCents(expense, id) > 0);
}

export function expensePersonalLabel(expense: ExpenseBalanceFields, memberId: string): string {
  if (expense.voidedAt) return "Voided";
  if (expense.paidBy === memberId) {
    const owedCents = participantIds(expense).reduce((sum, id) => sum + expenseOutstandingCents(expense, id), 0);
    if (owedCents > 0) return `Owed $${(owedCents / 100).toFixed(2)}`;
    return expense.settled ? "Settled" : "No repayment due";
  }
  const shareCents = expenseShareCents(expense, memberId);
  if (shareCents <= 0) return "Household total";
  const outstandingCents = expenseOutstandingCents(expense, memberId);
  if (outstandingCents > 0) return `You owe $${(outstandingCents / 100).toFixed(2)}`;
  return expensePaidCents(expense, memberId) >= shareCents ? "Your share paid" : "Settled";
}

/** Unloaded/failed initial data must never assert that somebody owes $0. */
export function projectExpenseBalances(expenses: readonly SummaryExpense[], memberId: string, ready: boolean) {
  return ready ? summarizeMemberIous(expenses, memberId) : null;
}
