import type { BorrowItem } from "../context/AppContext.ts";

export type SharedBorrowRow = {
  id: string; household_id: string; creator_id: string | null; owner_id: string | null;
  borrowed_from: string; borrowed_by: string | null; due_date: string; returned: boolean;
  entry: BorrowItem; created_at: string; updated_at: string;
};
export function sharedBorrowToRow(item: BorrowItem, householdId: string): SharedBorrowRow {
  const now = item.updatedAt ?? item.createdAt ?? new Date().toISOString();
  return { id: item.id, household_id: householdId, creator_id: item.creatorId ?? null,
    owner_id: item.ownerId ?? item.creatorId ?? null, borrowed_from: item.borrowedFrom,
    borrowed_by: item.borrowedBy ?? null, due_date: item.dueDate, returned: item.returned,
    entry: { ...item, householdId, visibility: "shared" }, created_at: item.createdAt ?? now,
    updated_at: now };
}
export function rowToSharedBorrow(row: SharedBorrowRow): BorrowItem {
  return { ...row.entry, id: row.id, householdId: row.household_id,
    creatorId: row.creator_id ?? undefined, ownerId: row.owner_id ?? undefined,
    visibility: "shared", borrowedFrom: row.borrowed_from,
    borrowedBy: row.borrowed_by ?? undefined, dueDate: row.due_date,
    returned: row.returned, createdAt: row.created_at, updatedAt: row.updated_at };
}
