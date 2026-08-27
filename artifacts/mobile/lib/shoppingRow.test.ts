import type { ShoppingItem, ShoppingList } from "../context/AppContext.ts";
import { rowToShoppingItem, rowToShoppingList, shoppingItemToRow, shoppingListToRow } from "./shoppingRow.ts";
function assert(value: boolean, message: string) { if (!value) throw new Error(message); }
const list: ShoppingList = { id: "list-1", name: "Groceries", pinned: true, plannedDate: "2026-08-28", updatedAt: "2026-08-27T10:00:00.000Z" };
const item: ShoppingItem = { id: "item-1", listId: list.id, name: "Milk", quantity: "2", addedBy: "user-1", completed: false, assignedTo: ["user-2"], price: 4.25, updatedAt: list.updatedAt };
const listRow = shoppingListToRow(list, "home-1", 3);
const itemRow = shoppingItemToRow(item, "home-1", 5);
assert(listRow.sort_order === 3 && itemRow.sort_order === 5, "shopping row order must be explicit");
assert(JSON.stringify(rowToShoppingList(listRow)) === JSON.stringify(list), "shopping lists must round-trip losslessly");
assert(JSON.stringify(rowToShoppingItem(itemRow)) === JSON.stringify(item), "shopping items must round-trip losslessly");
assert(itemRow.list_id === listRow.id, "shopping items must retain their parent list id");
console.log("shopping normalized row tests passed");
