import type { ShoppingItem, ShoppingList } from "../context/AppContext.ts";

const LEGACY_TIME = "1970-01-01T00:00:00.000Z";

export type ShoppingListRow = {
  id: string; household_id: string; name: string; assigned_to: string | null;
  pinned: boolean; planned_date: string | null; sort_order: number;
  entry: ShoppingList; updated_at: string;
};
export type ShoppingItemRow = {
  id: string; household_id: string; list_id: string; name: string;
  completed: boolean; sort_order: number; entry: ShoppingItem; updated_at: string;
};

export function shoppingListToRow(list: ShoppingList, householdId: string, index = 0): ShoppingListRow {
  return { id: list.id, household_id: householdId, name: list.name, assigned_to: list.assignedTo ?? null,
    pinned: list.pinned ?? false, planned_date: list.plannedDate ?? null, sort_order: index,
    entry: list, updated_at: list.updatedAt ?? LEGACY_TIME };
}
export function rowToShoppingList(row: ShoppingListRow): ShoppingList {
  return { ...row.entry, id: row.id, name: row.name, assignedTo: row.assigned_to ?? undefined,
    pinned: row.pinned, plannedDate: row.planned_date ?? undefined, updatedAt: row.updated_at };
}
export function shoppingItemToRow(item: ShoppingItem, householdId: string, index = 0): ShoppingItemRow {
  return { id: item.id, household_id: householdId, list_id: item.listId, name: item.name,
    completed: item.completed, sort_order: index, entry: item, updated_at: item.updatedAt ?? LEGACY_TIME };
}
export function rowToShoppingItem(row: ShoppingItemRow): ShoppingItem {
  return { ...row.entry, id: row.id, listId: row.list_id, name: row.name,
    completed: row.completed, updatedAt: row.updated_at };
}
