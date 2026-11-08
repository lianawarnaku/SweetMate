import type { Chore } from "../context/AppContext";
import {
  deriveCalendarItems,
  localCalendarDate,
  localDateKey,
} from "./calendarItems.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const members = [
  { id: "a", name: "A", color: "#000", points: 0, weeklyPoints: 0 },
  { id: "b", name: "B", color: "#111", points: 0, weeklyPoints: 0 },
];
const oneOff: Chore = {
  id: "one",
  householdId: "home-a",
  title: "One off",
  assignedTo: "a",
  dueDate: new Date(2026, 6, 27, 23, 59).toISOString(),
  completed: true,
  completedAt: new Date(2026, 6, 29, 20).toISOString(),
  points: 10,
  category: "other",
};
const recurring: Chore = {
  id: "monday",
  householdId: "home-a",
  title: "Recurring",
  assignedTo: "a",
  dueDate: new Date(2026, 6, 27, 23, 59).toISOString(),
  initialDueDate: new Date(2026, 6, 27, 23, 59).toISOString(),
  completed: true,
  completedAt: new Date(2026, 6, 28, 10).toISOString(),
  points: 10,
  category: "cleaning",
  recurring: "weekly",
  recurrenceSeriesId: "weekly-series",
};
const nextRecurring: Chore = {
  ...recurring,
  id: "next-monday",
  dueDate: new Date(2026, 7, 3, 23, 59).toISOString(),
  completed: false,
  completedAt: undefined,
  occurrenceIndex: 1,
};
const items = deriveCalendarItems(
  {
    chores: [oneOff, recurring, nextRecurring],
    shoppingItems: [],
    shoppingLists: [],
    expenses: [],
    roommates: members,
    currentUserId: "a",
    householdId: "home-a",
  },
  new Date(2026, 6, 27),
  new Date(2026, 7, 5),
);
const oneOffItems = items.filter((item) => item.sourceId === "one");
assert(oneOffItems.length === 1 && oneOffItems[0].completed === true, "a completed one-off must remain on its completion date");
assert(oneOffItems[0].date === "2026-07-29", "completed history must use the completion day");
const recurringItems = items.filter((item) => item.type === "chore" && item.title === "Recurring");
assert(recurringItems.length === 2, "calendar must show only durable recurring occurrence records");
assert(recurringItems[0].completed === true, "stored recurring occurrence must retain completion");
assert(recurringItems[1].completed === false, "explicit future occurrence must remain unchecked");
assert(new Set(recurringItems.map((item) => item.occurrenceId)).size === 2, "recurring occurrence IDs must remain distinct");

const otherHousehold = deriveCalendarItems(
  {
    chores: [{ ...oneOff, householdId: "home-b" }],
    shoppingItems: [],
    shoppingLists: [],
    expenses: [],
    roommates: members,
    currentUserId: "a",
    householdId: "home-a",
  },
  new Date(2026, 6, 27),
  new Date(2026, 6, 27),
);
assert(otherHousehold.length === 0, "calendar derivation must isolate households");
assert(localDateKey(localCalendarDate("2028-02-29")!) === "2028-02-29", "date-only leap days must remain stable");

// Legacy expense labels must not invent unpaid future IOUs in the calendar.
const expenses = deriveCalendarItems({
  chores: [], shoppingItems: [], shoppingLists: [], roommates: members,
  currentUserId: "a", householdId: "home-a",
  expenses: [{ id: "rent", title: "Rent", date: "2026-07-27", category: "rent", amount: 100, amountCents: 10000,
    paidBy: "a", sharedWith: ["b"], splits: { b: 100 }, settled: true, recurring: "daily" }],
}, new Date(2026, 6, 27), new Date(2026, 7, 5));
assert(expenses.length === 1 && expenses[0].completed === true && expenses[0].isRecurring === false,
  "only the saved expense may appear; legacy recurrence must not fabricate unpaid occurrences");
