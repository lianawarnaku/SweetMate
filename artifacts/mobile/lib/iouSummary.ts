/** Read-only net position. Offsetting debts do not settle individual IOUs. */
export interface SummaryExpense {
  paidBy: string;
  splits?: Record<string, number> | null;
  allocations?: readonly { participantId: string; amountCents: number }[] | null;
  paidBack?: Record<string, boolean> | null;
  settled?: boolean;
}

export function summarizeMemberIous(expenses: readonly SummaryExpense[], memberId: string) {
  let owedCents = 0;
  let owingCents = 0;
  for (const expense of expenses) {
    if (expense.settled) continue;
    const shares = expense.allocations != null
      ? expense.allocations.map(({ participantId, amountCents }) => [participantId, amountCents] as const)
      : Object.entries(expense.splits ?? {}).map(([id, dollars]) => [id, Math.round(dollars * 100)] as const);
    const counted = new Set<string>();
    for (const [debtor, cents] of shares) {
      if (counted.has(debtor)) continue;
      counted.add(debtor);
      if (debtor === expense.paidBy || expense.paidBack?.[debtor]) continue;
      if (!Number.isSafeInteger(cents) || cents <= 0) continue;
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
