import { selectUpNextChore } from "./homeFocus.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const chores = [
  { id: "later", completed: false, dueDate: "2030-01-03T09:00:00.000Z" },
  { id: "done", completed: true, dueDate: "2029-12-01T09:00:00.000Z" },
  { id: "overdue", completed: false, dueDate: "2029-12-31T09:00:00.000Z" },
  { id: "invalid", completed: false, dueDate: "not-a-date" },
] as const;
const originalOrder = chores.map((chore) => chore.id).join(",");

assert(selectUpNextChore(chores)?.id === "overdue", "the earliest incomplete chore must be up next");
assert(chores.map((chore) => chore.id).join(",") === originalOrder, "selection must not reorder chores");
assert(
  selectUpNextChore([
    { id: "first", completed: false, dueDate: "2030-01-01T09:00:00.000Z" },
    { id: "second", completed: false, dueDate: "2030-01-01T09:00:00.000Z" },
  ])?.id === "first",
  "equal due dates must preserve the existing order",
);
assert(
  selectUpNextChore([{ id: "done", completed: true, dueDate: "2030-01-01T09:00:00.000Z" }]) === undefined,
  "completed chores must never be selected",
);

console.log("home focus tests passed");

