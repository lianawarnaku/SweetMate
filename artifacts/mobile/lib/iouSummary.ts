import { expenseOutstandingCents, type ExpenseBalanceFields } from "./expensePolicy.ts";

/** Read-only net position. Offsetting debts do not settle individual IOUs. */
export interface SummaryExpense extends ExpenseBalanceFields {}

export function summarizeMemberIous(expenses: readonly SummaryExpense[], memberId: string) {
  let owedCents = 0;
  let owingCents = 0;
  for (const expense of expenses) {
    if (expense.settled || expense.voidedAt) continue;
    const participants = new Set(expense.allocations != null
      ? expense.allocations.map(({ participantId }) => participantId)
      : Object.keys(expense.splits ?? {}));
    for (const debtor of participants) {
      const cents = expenseOutstandingCents(expense, debtor);
      if (cents <= 0) continue;
      if (expense.paidBy === memberId) owedCents += cents;
      if (debtor === memberId) owingCents += cents;
    }
  }
  return {
    owedCents,
    owingCents,
    netCents: owedCents - owingCents,
    hasOutstandingDebts: owedCents > 0 || owingCents > 0,
  };
}
