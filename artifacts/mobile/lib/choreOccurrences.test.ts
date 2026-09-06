import type { Chore } from "../context/AppContext";
import {
  choreLocalDateKey,
  choreOccurrenceIdentity,
  choreScheduledDate,
  deleteRecurringChore,
  isChoreActiveOnDay,
  isBeforeLocalCalendarDay,
  isChoreCarryoverOnDay,
  MAX_RECURRING_OCCURRENCES_PER_PASS,
  materializeRecurringOccurrences,
  recurringOccurrenceId,
  recurringMaterializationFloor,
} from "./choreOccurrences.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const due = new Date(2026, 6, 27, 23, 59).toISOString();
const oneOff: Chore = {
  id: "one",
  householdId: "home-a",
  title: "One off",
  assignedTo: "a",
  dueDate: due,
  completed: false,
  points: 10,
  category: "other",
};

assert(isChoreActiveOnDay(oneOff, new Date(2026, 6, 27, 12)), "one-off must be active on its scheduled day");
assert(isChoreCarryoverOnDay(oneOff, new Date(2026, 6, 28, 0, 0, 0, 1)), "one-off must carry after midnight");
assert(isChoreCarryoverOnDay(oneOff, new Date(2026, 6, 29, 12)), "one-off must continue carrying over");
assert(choreLocalDateKey(oneOff.dueDate) === "2026-07-27", "carryover must preserve the original date");
assert(
  !isBeforeLocalCalendarDay("2026-07-27", new Date(2026, 6, 27, 23, 59)),
  "an item due today must not become overdue before the day ends",
);
assert(
  isBeforeLocalCalendarDay("2026-07-26", new Date(2026, 6, 27, 0, 1)),
  "an item from a previous calendar day must be overdue",
);
assert(
  !isBeforeLocalCalendarDay("not-a-date", new Date(2026, 6, 27)),
  "invalid dates must not be presented as overdue",
);

const completed = {
  ...oneOff,
  completed: true,
  completedAt: new Date(2026, 6, 29, 12).toISOString(),
};
assert(!isChoreActiveOnDay(completed, new Date(2026, 6, 30)), "completed one-off must not carry forward");
assert(choreLocalDateKey(completed.dueDate) === "2026-07-27", "completion must preserve one-off history");

const recurring: Chore = {
  ...oneOff,
  id: "daily-root",
  title: "Daily",
  recurring: "daily",
  recurrenceSeriesId: "daily-root",
  initialDueDate: due,
  occurrenceIndex: 0,
};
const materialized = materializeRecurringOccurrences(
  [recurring],
  new Date(2026, 6, 29, 12),
);
const daily = materialized
  .filter((chore) => chore.recurrenceSeriesId === "daily-root")
  .sort((left, right) => left.dueDate.localeCompare(right.dueDate));
assert(daily.length === 3, "each due recurring occurrence must be materialized independently");
assert(new Set(daily.map(choreOccurrenceIdentity)).size === 3, "recurring occurrence identities must be unique");
assert(daily.every((chore) => !chore.completed), "new recurring occurrences must begin unchecked");
assert(isChoreCarryoverOnDay(daily[0], new Date(2026, 6, 29)), "missed Monday occurrence must coexist as carryover");
assert(isChoreCarryoverOnDay(daily[1], new Date(2026, 6, 29)), "multiple missed occurrences must remain actionable");
assert(isChoreActiveOnDay(daily[2], new Date(2026, 6, 29)), "current occurrence must be independently active");

const mondayDone = daily.map((chore, index) =>
  index === 0 ? { ...chore, completed: true, completedAt: new Date().toISOString() } : chore
);
assert(!isChoreActiveOnDay(mondayDone[0], new Date(2026, 6, 30)), "completing one occurrence must stop only its carryover");
assert(isChoreActiveOnDay(mondayDone[1], new Date(2026, 6, 30)), "another missed occurrence must remain active");
assert(!mondayDone[2].completed, "completion must not leak to a later occurrence");

const rerun = materializeRecurringOccurrences(
  materialized,
  new Date(2026, 6, 29, 12),
);
assert(rerun === materialized, "reconciliation must be idempotent and create no daily duplicates");

const reassigned = { ...oneOff, assignedTo: "b" };
assert(choreOccurrenceIdentity(reassigned) === choreOccurrenceIdentity(oneOff), "reassignment must preserve occurrence identity");
assert(reassigned.assignedTo === "b" && choreLocalDateKey(reassigned.dueDate) === "2026-07-27", "reassignment must update the same occurrence");

const otherHousehold = { ...recurring, id: "other-root", householdId: "home-b" };
const isolated = materializeRecurringOccurrences(
  [recurring, otherHousehold],
  new Date(2026, 6, 28),
);
assert(
  isolated.filter((chore) => chore.householdId === "home-a").length === 2 &&
    isolated.filter((chore) => chore.householdId === "home-b").length === 2,
  "materialization must isolate households",
);

const weeklyRoot: Chore = {
  ...recurring,
  id: "weekly-root",
  recurrenceSeriesId: "weekly-root",
  recurring: "weekly",
  dueDate: new Date(2026, 6, 6, 23, 59).toISOString(),
  initialDueDate: new Date(2026, 6, 6, 23, 59).toISOString(),
};
const weeklyCatchUp = materializeRecurringOccurrences(
  [weeklyRoot],
  new Date(2026, 6, 27, 12),
);
assert(
  weeklyCatchUp.filter((chore) => chore.recurrenceSeriesId === "weekly-root").length === 4,
  "app-closed catch-up must materialize every missed weekly occurrence",
);
assert(
  weeklyCatchUp.every((chore) => choreScheduledDate(chore) !== ""),
  "every recurring occurrence must persist a timezone-stable scheduled date",
);

const biweeklyRoot: Chore = {
  ...weeklyRoot,
  id: "biweekly-root",
  recurrenceSeriesId: "biweekly-root",
  recurring: "biweekly",
};
assert(
  materializeRecurringOccurrences([biweeklyRoot], new Date(2026, 7, 3))
    .filter((chore) => chore.recurrenceSeriesId === "biweekly-root").length === 3,
  "biweekly catch-up must preserve the two-week interval",
);

const historical = materialized.map((chore) => ({
  ...chore,
  completed: true,
  completedAt: "2026-07-30T12:00:00.000Z",
}));
assert(
  materializeRecurringOccurrences(historical, new Date(2026, 6, 29)) === historical,
  "completed historical occurrence identities must prevent regeneration",
);

const deterministicA = materializeRecurringOccurrences(
  [weeklyRoot],
  new Date(2026, 6, 13),
);
const deterministicB = materializeRecurringOccurrences(
  [weeklyRoot],
  new Date(2026, 6, 13),
);
assert(
  deterministicA.map((chore) => chore.id).join(",") ===
    deterministicB.map((chore) => chore.id).join(","),
  "two clients must derive the same deterministic occurrence IDs",
);

const longCatchUpFirstPass = materializeRecurringOccurrences(
  [recurring],
  new Date(2027, 7, 31),
);
assert(
  longCatchUpFirstPass.length === 16,
  "a long-dormant daily series must preserve its anchor and create only the rolling 14-day window",
);
assert(
  longCatchUpFirstPass[0].materializationStartsOn === "2027-08-17" &&
    recurringMaterializationFloor(new Date(2027, 7, 31)) === "2027-08-17",
  "fast-forwarding must persist one deterministic series cutoff",
);
assert(
  !longCatchUpFirstPass.some((chore) => choreScheduledDate(chore) === "2027-03-03"),
  "never-materialized dates older than the archive window must not be manufactured",
);
const longCatchUpSecondPass = materializeRecurringOccurrences(
  longCatchUpFirstPass,
  new Date(2027, 7, 31),
);
assert(
  longCatchUpSecondPass === longCatchUpFirstPass,
  "a later lifecycle pass must not resume intentionally skipped history",
);

const preservedOldCompletion: Chore = {
  ...recurring,
  id: recurringOccurrenceId("home-a", "daily-root", "2027-03-03"),
  scheduledDate: "2027-03-03",
  dueDate: new Date(2027, 2, 3, 23, 59).toISOString(),
  occurrenceIndex: 219,
  completed: true,
  completedAt: "2027-03-03T23:59:00.000Z",
};
const catchUpWithHistory = materializeRecurringOccurrences(
  [recurring, preservedOldCompletion],
  new Date(2027, 7, 31),
);
assert(
  catchUpWithHistory.some((chore) => chore.id === preservedOldCompletion.id && chore.completed),
  "fast-forwarding must preserve old history that already exists",
);
assert(
  catchUpWithHistory.length < MAX_RECURRING_OCCURRENCES_PER_PASS,
  "fast-forwarding must remain below the former per-pass backlog cap",
);

const deletedOccurrence = deleteRecurringChore(
  weeklyCatchUp,
  weeklyCatchUp[1],
  "occurrence",
  "2026-07-30T12:00:00.000Z",
);
assert(
  materializeRecurringOccurrences(deletedOccurrence, new Date(2026, 6, 27))
    .length === deletedOccurrence.length,
  "deleting one occurrence must persist an exclusion and prevent regeneration",
);
const deletedFuture = deleteRecurringChore(
  weeklyCatchUp,
  weeklyCatchUp[2],
  "future",
  "2026-07-30T12:00:00.000Z",
);
assert(
  materializeRecurringOccurrences(deletedFuture, new Date(2026, 7, 31))
    .length === deletedFuture.length,
  "deleting this and future must persist a series end date",
);
assert(
  deleteRecurringChore(
    weeklyCatchUp,
    weeklyCatchUp[0],
    "series",
    "2026-07-30T12:00:00.000Z",
  ).length === 0,
  "deleting a recurring series with no completed history must remove every occurrence",
);

// Regression: "delete entire series" must keep completed history and only
// remove what hasn't happened, not erase the whole record of the series.
const weeklyWithHistory = weeklyCatchUp.map((chore, index) =>
  index < 2 ? { ...chore, completed: true, completedAt: "2026-07-20T12:00:00.000Z" } : chore
);
const seriesDeletedWithHistory = deleteRecurringChore(
  weeklyWithHistory,
  weeklyWithHistory[2],
  "series",
  "2026-07-30T12:00:00.000Z",
);
assert(
  seriesDeletedWithHistory.length === 2 &&
    seriesDeletedWithHistory.every((chore) => chore.completed),
  "deleting a series must preserve completed occurrences and remove only incomplete ones",
);
assert(
  materializeRecurringOccurrences(seriesDeletedWithHistory, new Date(2026, 7, 31))
    .length === seriesDeletedWithHistory.length,
  "a deleted series must not regenerate future occurrences on the next materialization pass",
);

// Regression: editing a recurring occurrence's due date to a different
// calendar date used to leave its original slot looking "empty" to the
// materializer, which would regenerate a phantom duplicate there on the
// next pass. Moving the occurrence and excluding its vacated date (what
// AppContext.updateChore now does) must prevent that duplicate.
const editedOccurrence = weeklyCatchUp[1];
const vacatedDate = choreScheduledDate(editedOccurrence);
const movedDate = "2026-07-23";
const editedSeries = weeklyCatchUp.map((chore) =>
  chore.id === editedOccurrence.id
    ? {
        ...chore,
        dueDate: new Date(2026, 6, 23, 23, 59).toISOString(),
        scheduledDate: movedDate,
        excludedOccurrenceDates: [
          ...new Set([...(chore.excludedOccurrenceDates ?? []), vacatedDate]),
        ],
        updatedAt: "2026-07-30T12:00:00.000Z",
      }
    : chore
);
const afterEditRematerialize = materializeRecurringOccurrences(
  editedSeries,
  new Date(2026, 6, 27),
);
assert(
  afterEditRematerialize.length === editedSeries.length,
  "moving a recurring occurrence's date must not spawn a phantom duplicate at the vacated slot",
);
