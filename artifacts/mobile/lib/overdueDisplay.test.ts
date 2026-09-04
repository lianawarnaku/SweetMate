import { strict as assert } from "node:assert";

import { compactOverdueItems } from "./overdueDisplay.ts";

type Item = { id: string; title: string; overdue: boolean; recurring: boolean };

const items: Item[] = [
  { id: "1", title: "Dishes", overdue: true, recurring: true },
  { id: "2", title: "Dishes", overdue: true, recurring: true },
  { id: "3", title: "Trash", overdue: true, recurring: true },
  { id: "4", title: "Vacuum", overdue: true, recurring: false },
  { id: "5", title: "Laundry", overdue: true, recurring: false },
  { id: "6", title: "Today", overdue: false, recurring: false },
];

const compact = compactOverdueItems(items, {
  expanded: false,
  isOverdue: (item) => item.overdue,
  keyForRepeatedItem: (item) => item.recurring ? item.title.toLowerCase() : item.id,
});

assert.deepEqual(compact.visibleItems.map((item) => item.id), ["1", "3", "4", "6"]);
assert.equal(compact.hiddenCount, 2);

const expanded = compactOverdueItems(items, {
  expanded: true,
  isOverdue: (item) => item.overdue,
  keyForRepeatedItem: (item) => item.id,
});

assert.deepEqual(expanded.visibleItems, items);
assert.equal(expanded.hiddenCount, 0);

console.log("overdue display tests passed");
