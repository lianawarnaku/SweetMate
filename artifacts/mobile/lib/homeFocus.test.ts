import { isHomeCaughtUp, selectUpNextChore } from "./homeFocus.ts";

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


const checkedChore = { completed: true };
const checkedShopping = { completed: true };
const checkedTask = { source: "google-task" as const, app_completed_at: "2030-01-01T10:00:00Z" };
const caughtUpState = { chores: [checkedChore], shoppingItems: [checkedShopping], scheduleItems: [checkedTask] };
assert(isHomeCaughtUp(caughtUpState), "all checked personal lists can show the caught-up summary");
assert(!isHomeCaughtUp({ ...caughtUpState, chores: [{ completed: false }] }), "unchecking a chore must immediately clear caught-up eligibility");
assert(!isHomeCaughtUp({ ...caughtUpState, shoppingItems: [{ completed: false }] }), "unchecking assigned shopping must clear caught-up eligibility even with every chore checked");
assert(!isHomeCaughtUp({ ...caughtUpState, scheduleItems: [{ ...checkedTask, app_completed_at: null }] }), "unchecking a personal task must clear caught-up eligibility");
assert(isHomeCaughtUp(caughtUpState), "checking the reopened item again permits the summary again");
assert(isHomeCaughtUp({ chores: [{ completed: false, skippedAt: "2030-01-01" }], shoppingItems: [], scheduleItems: [] }), "skipped chores do not block the summary");
assert(!isHomeCaughtUp({ ...caughtUpState, scheduleItems: [{ source: "google-event", app_completed_at: null }] }), "an unchecked imported event must block the caught-up summary now that events are checkable");
assert(isHomeCaughtUp({ ...caughtUpState, scheduleItems: [{ source: "google-event", app_completed_at: "2030-01-01T10:00:00Z" }] }), "checked events count as complete");
console.log("Caught-up summary completion/undo regression tests passed for chores, shopping and personal tasks.");
