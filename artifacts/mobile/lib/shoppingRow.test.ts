import assertStrict from "node:assert/strict";
import type { ShoppingItem, ShoppingList } from "../context/AppContext.ts";
import { rowToShoppingItem, rowToShoppingList, shoppingItemToRow, shoppingListToRow } from "./shoppingRow.ts";
function assert(value: boolean, message: string) { if (!value) throw new Error(message); }
const list: ShoppingList = { id: "list-1", name: "Groceries", pinned: true, plannedDate: "2026-08-28", plannedTime: "15:45", updatedAt: "2026-08-27T10:00:00.000Z" };
const item: ShoppingItem = { id: "item-1", listId: list.id, name: "Milk", quantity: "2", addedBy: "user-1", completed: false, neededByDate: "2026-08-29", neededByTime: "09:30", assignedTo: ["user-2"], price: 4.25, updatedAt: list.updatedAt };
const listRow = shoppingListToRow(list, "home-1", 3);
const itemRow = shoppingItemToRow(item, "home-1", 5);
assert(listRow.sort_order === 3 && itemRow.sort_order === 5, "shopping row order must be explicit");
assertStrict.deepEqual(JSON.parse(JSON.stringify(rowToShoppingList(listRow))), { ...list, sortOrder: 3 }, "shopping lists and ranks round-trip");
assertStrict.deepEqual(JSON.parse(JSON.stringify(rowToShoppingItem(itemRow))), { ...item, sortOrder: 5 }, "shopping items and ranks round-trip");
assert(itemRow.list_id === listRow.id, "shopping items must retain their parent list id");
console.log("shopping normalized row tests passed");

assert(listRow.planned_date === "2026-08-28" && listRow.entry.plannedTime === "15:45", "shared list dates stay date-only while exact time survives in the shared entry");
assert(itemRow.entry.neededByTime === "09:30", "scheduled item times must survive the normalized shared row");
