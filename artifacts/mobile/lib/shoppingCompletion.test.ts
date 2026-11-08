import assert from "node:assert/strict";
import { setShoppingCompletion } from "./shoppingCompletion.ts";

const checked = {
  id: "milk", completed: true, updatedAt: "2026-11-07T14:00:00.000Z",
  listId: "groceries", name: "Milk", quantity: "2", price: 4.5,
  assignedTo: ["member"], convertedExpenseId: "existing-expense",
};
const other = { ...checked, id: "bread", name: "Bread" };
const items = [checked, other];
const undone = setShoppingCompletion(items, "milk", false, "2026-11-07T14:01:00.000Z");
assert.equal(undone[0].completed, false, "undo returns the item to the needed list");
assert.equal(undone[0].updatedAt, "2026-11-07T14:01:00.000Z", "undo participates in shopping sync");
assert.equal(checked.completed, true, "undo does not mutate the previous state");
assert.equal(undone[1], other, "other items are unchanged");
assert.deepEqual(undone[0].assignedTo, checked.assignedTo);
assert.equal(undone[0].convertedExpenseId, "existing-expense", "undo must preserve its expense link");
assert.equal(undone[0].price, checked.price);
assert.equal(setShoppingCompletion(undone, "milk", false, "later"), undone,
  "repeated undo cannot accidentally check the item again");
assert.equal(setShoppingCompletion(undone, "deleted-item", false, "later"), undone,
  "a stale popup cannot restore a deleted item");
assert.equal(setShoppingCompletion(undone, "milk", true, "later")[0].completed, true,
  "the item can be checked off again after undo");
console.log("shopping completion undo tests passed");
