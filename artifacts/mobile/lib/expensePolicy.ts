import type { Expense } from "../context/AppContext.ts";
import type { StoredExpenseAllocation } from "./money.ts";
import { normalizeExpenseDate } from "./expenseDate.ts";

type ExpenseActorFields = Pick<Expense, "paidBy" | "creatorId">;
type ExpenseShares = Pick<Expense, "paidBy" | "splits" | "allocations" | "paidBack" | "settled">;

/** Legacy expenses without a creator belong to their recorded payer. */
export function canEditExpense(expense: ExpenseActorFields, actorId: string): boolean {
  return Boolean(actorId) && (expense.creatorId || expense.paidBy) === actorId;
}

export function canManageExpense(
  expense: ExpenseActorFields,
  actorId: string,
  isHost = false,
): boolean {
  return Boolean(actorId) && (isHost || expense.paidBy === actorId || canEditExpense(expense, actorId));
}

/** Any recorded payment locks financial edits, including inconsistent legacy flags. */
export function hasExpensePayments(expense: Pick<Expense, "settled" | "paidBack">): boolean {
  return expense.settled === true || Object.values(expense.paidBack ?? {}).some((paid) => paid === true);
}

function dollarCents(value: number, label: string): number {
  const cents = Math.round(value * 100);
  if (
    !Number.isFinite(value) ||
    !Number.isSafeInteger(cents) ||
    Math.abs(value * 100 - cents) > 0.000001
  ) throw new Error(`${label} must be a valid amount with at most two decimal places.`);
  return cents;
}

function allocationEntries(expense: Pick<Expense, "splits" | "allocations">): StoredExpenseAllocation[] {
  if (expense.allocations !== undefined) return expense.allocations.map((allocation) => ({ ...allocation }));
  return Object.entries(expense.splits ?? {}).map(([participantId, amount]) => ({
    participantId,
    amountCents: dollarCents(amount, "A participant's share"),
  }));
}

/** Use cent allocations whenever available; dollar splits are a legacy fallback. */
export function expenseShareCents(
  expense: Pick<Expense, "splits" | "allocations">,
  participantId: string,
): number {
  if (expense.allocations !== undefined) {
    const cents = expense.allocations.find((allocation) => allocation.participantId === participantId)?.amountCents ?? 0;
    return Number.isSafeInteger(cents) && cents > 0 ? cents : 0;
  }
  const amount = expense.splits?.[participantId] ?? 0;
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : 0;
}

export function allExpenseSharesPaid(expense: ExpenseShares): boolean {
  const participants = expense.allocations !== undefined
    ? expense.allocations.map((allocation) => allocation.participantId)
    : Object.keys(expense.splits ?? {});
  return participants.every((id) =>
    id === expense.paidBy || expenseShareCents(expense, id) === 0 || expense.paidBack?.[id] === true,
  );
}

/** Validate once at the mutation boundary, with integer cents as the canonical money. */
export function canonicalExpense(expense: Expense, activeMemberIds: ReadonlySet<string>): Expense {
  if (!activeMemberIds.has(expense.paidBy)) throw new Error("Choose an active Sweetmate as payer.");
  const participants = [...expense.sharedWith];
  const participantSet = new Set(participants);
  if (
    participants.length === 0 ||
    participantSet.size !== participants.length ||
    participants.some((id) => !activeMemberIds.has(id))
  ) throw new Error("Expense participants must be unique active household members.");

  const amountFromDollars = dollarCents(expense.amount, "The expense total");
  const amountCents = expense.amountCents ?? amountFromDollars;
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents !== amountFromDollars) {
    throw new Error("The expense total and cent amount must agree and be positive.");
  }

  const entries = allocationEntries(expense);
  const allocations = new Map(entries.map((allocation) => [allocation.participantId, allocation.amountCents]));
  if (
    entries.length !== participants.length || allocations.size !== entries.length ||
    entries.some(({ participantId, amountCents: cents }) =>
      !participantSet.has(participantId) || !Number.isSafeInteger(cents) || cents < 0,
    ) ||
    entries.reduce((total, allocation) => total + allocation.amountCents, 0) !== amountCents
  ) throw new Error("Allocate the full expense total once among its participants.");

  const splitEntries = Object.entries(expense.splits ?? {});
  if (
    splitEntries.length !== participants.length ||
    splitEntries.some(([id, amount]) => !participantSet.has(id) || dollarCents(amount, "A participant's share") !== allocations.get(id))
  ) throw new Error("Dollar shares and cent allocations must agree.");

  const date = normalizeExpenseDate(expense.date);
  if (date === null) throw new Error("Choose a valid expense date.");
  const canonicalAllocations = participants.map((participantId) => ({
    participantId,
    amountCents: allocations.get(participantId)!,
  }));
  return {
    ...expense,
    amount: amountCents / 100,
    amountCents,
    sharedWith: participants,
    allocations: canonicalAllocations,
    splits: Object.fromEntries(canonicalAllocations.map(({ participantId, amountCents: cents }) => [participantId, cents / 100])),
    date,
  };
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

/** Descriptive edits are allowed after payment; changing any financial term is not. */
export function expenseFinancialSignature(expense: Expense): string {
  const source = expense.shoppingSource;
  return JSON.stringify(stable({
    amountCents: expense.amountCents ?? dollarCents(expense.amount, "The expense total"),
    dollarAmountCents: dollarCents(expense.amount, "The expense total"),
    paidBy: expense.paidBy,
    sharedWith: [...expense.sharedWith].sort(),
    allocations: allocationEntries(expense).sort((a, b) => a.participantId.localeCompare(b.participantId)),
    splits: Object.entries(expense.splits ?? {}).map(([id, amount]) => [id, dollarCents(amount, "A participant's share")] as const).sort(([a], [b]) => a.localeCompare(b)),
    date: normalizeExpenseDate(expense.date) ?? expense.date,
    splitMode: expense.splitMode ?? "exact",
    shoppingSource: source ? {
      ...source,
      shoppingItemIds: [...source.shoppingItemIds].sort(),
      individualAllocations: source.individualAllocations
        ? [...source.individualAllocations].sort((a, b) => a.itemId.localeCompare(b.itemId) || a.expenseId.localeCompare(b.expenseId))
        : undefined,
    } : null,
  }));
}
