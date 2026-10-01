/** Read-only net position. Offsetting debts do not settle individual IOUs. */
export interface SummaryExpense {
  paidBy: string;
  splits?: Record<string, number> | null;
  paidBack?: Record<string, boolean> | null;
  settled?: boolean;
}

export function summarizeMemberIous(expenses: readonly SummaryExpense[], memberId: string) {
  let owedCents = 0;
  let owingCents = 0;
  for (const expense of expenses) {
    if (expense.settled) continue;
    for (const [debtor, share] of Object.entries(expense.splits ?? {})) {
      if (debtor === expense.paidBy || expense.paidBack?.[debtor]) continue;
      if (!Number.isFinite(share) || share <= 0) continue;
      const cents = Math.round(share * 100);
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
