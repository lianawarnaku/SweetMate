import { currentHouseholdWeekChores } from "./groupChores.ts";
import { upcomingHouseholdChores, upcomingChoreDueLabel } from "./upcomingChores.ts";
import type { Chore } from "../context/AppContext";
import {
  activeChores,
  choresActiveOnSelectedDay,
  ARCHIVE_INCOMPLETE_AFTER_DAYS,
  completedRetentionBoundary,
  incompleteArchiveBoundary,
  isActiveChore,
  isArchivedIncomplete,
  isChoreInCurrentWeek,
  isRecentlyCompleted,
  startOfLocalWeek,
} from "./choreLifecycle.ts";
import { isChoreActiveOnDay } from "./choreOccurrences.ts";
import { choreCompletionTransition } from "./choreCompletion.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const now = new Date(2026, 6, 29, 12);
const base: Chore = {
  id: "base",
  householdId: "home-a",
  title: "Chore",
  assignedTo: "member-a",
  dueDate: new Date(2026, 6, 29, 9).toISOString(),
  completed: false,
  points: 10,
  category: "cleaning",
};

assert(isChoreActiveOnDay(base, now), "an incomplete chore due today must appear in Today");
const oldIncomplete = { ...base, id: "old", dueDate: new Date(2026, 5, 29, 9).toISOString() };
assert(isChoreActiveOnDay(oldIncomplete, now), "a 30-day-old incomplete chore must remain in Today");
assert(
  [oldIncomplete].filter((chore) => isChoreActiveOnDay(chore, now)).length === 1,
  "an overdue chore must appear only once in Today",
);

const completedAt = new Date(2026, 6, 22, 12);
const recentDone = { ...base, id: "recent", completed: true, completedAt: completedAt.toISOString() };
const justBeforeBoundary = new Date(2026, 6, 29, 11, 59, 59, 999);
assert(isRecentlyCompleted(recentDone, justBeforeBoundary), "completion must remain active before seven calendar days");
const boundary = completedRetentionBoundary(recentDone)!;
assert(boundary.getTime() === now.getTime(), "retention must add seven local calendar days");
assert(!isRecentlyCompleted(recentDone, boundary), "completion must become historical at the exact boundary");
assert(!isActiveChore(recentDone, boundary), "historical completion must leave active lists");

// Regression for #9 (a long-neglected recurring series materializing a wall
// of overdue occurrences at once): an incomplete chore now archives out of
// the active lists after two weeks, distinct from isChoreActiveOnDay (the
// calendar day view above), which intentionally still shows it.
const justInsideArchiveWindow = new Date(base.dueDate);
justInsideArchiveWindow.setDate(justInsideArchiveWindow.getDate() + ARCHIVE_INCOMPLETE_AFTER_DAYS - 1);
assert(
  !isArchivedIncomplete(base, justInsideArchiveWindow) && isActiveChore(base, justInsideArchiveWindow),
  "an incomplete chore must remain active for the first two weeks it's overdue",
);
const archiveBoundary = new Date(base.dueDate);
archiveBoundary.setDate(archiveBoundary.getDate() + ARCHIVE_INCOMPLETE_AFTER_DAYS);
assert(
  incompleteArchiveBoundary(base)?.getTime() === archiveBoundary.getTime(),
  "the lifecycle clock must be able to schedule the exact incomplete archive boundary",
);
assert(
  isArchivedIncomplete(base, archiveBoundary) && !isActiveChore(base, archiveBoundary),
  "an incomplete chore must archive out of active lists at exactly two weeks overdue",
);
assert(
  isArchivedIncomplete(oldIncomplete, boundary) && !isActiveChore(oldIncomplete, boundary),
  "a 30-day-overdue incomplete chore is well past the archive threshold",
);
assert(
  isChoreActiveOnDay(oldIncomplete, boundary),
  "archiving from the active lists must not affect the separate calendar day view",
);
const archivedCompletion = choreCompletionTransition(
  oldIncomplete.completed,
  true,
  oldIncomplete.points,
);
assert(
  archivedCompletion.changed && archivedCompletion.pointsDelta === oldIncomplete.points,
  "completing an archived chore must award its normal points",
);

const legacyDone = { ...base, id: "legacy", completed: true, completedAt: undefined };
assert(isActiveChore(legacyDone, now), "legacy completion without a trustworthy timestamp must not be silently archived");

const sunday = startOfLocalWeek(now);
assert(sunday.getDay() === 0, "the app's local calendar week must begin Sunday");
const thisWeek = { ...base, id: "week", dueDate: new Date(2026, 6, 31, 9).toISOString() };
const nextWeek = { ...base, id: "next-week", dueDate: new Date(2026, 7, 3, 9).toISOString() };
assert(isChoreInCurrentWeek(thisWeek, now), "Week must include a chore due this local week");
assert(!isChoreInCurrentWeek(nextWeek, now), "Week must exclude a future chore outside this local week");
assert(isChoreInCurrentWeek(base, now), "Week must retain a recently-overdue chore that hasn't archived yet");
assert(
  !isChoreInCurrentWeek(oldIncomplete, now),
  "Week must also exclude a chore that has archived out of the active lists",
);

const history = Array.from({ length: 10_000 }, (_, index): Chore => ({
  ...base,
  id: `history-${index}`,
  completed: true,
  completedAt: new Date(2025, 0, 1, 12).toISOString(),
}));
const active = Array.from({ length: 1_000 }, (_, index): Chore => ({
  ...base,
  id: `active-${index}`,
}));
assert(activeChores([...history, ...active], now).length === 1_000, "active screens must exclude 10,000 historical chores");


const upcomingNow = new Date("2026-11-24T18:00:00Z");
const upcomingTimezone = "America/New_York";
const tomorrowChore: Chore = { ...base, id: "upcoming-daily", dueDate: "2026-11-25T14:00:00Z", scheduledDate: "2026-11-25", recurring: "daily" };
const weeklyChore: Chore = { ...tomorrowChore, id: "upcoming-weekly", dueDate: "2026-12-01T17:00:00Z", scheduledDate: "2026-12-01", recurring: "weekly" };
const monthlyChore: Chore = { ...tomorrowChore, id: "upcoming-monthly", dueDate: "2026-12-24T17:00:00Z", scheduledDate: "2026-12-24", recurring: "monthly" };
const upcomingSaved = [weeklyChore, monthlyChore, tomorrowChore,
  { ...tomorrowChore, id: "other-home", householdId: "home-b" },
  { ...tomorrowChore, id: "done-future", completed: true },
  { ...tomorrowChore, id: "skipped-future", skippedAt: upcomingNow.toISOString() },
  { ...tomorrowChore, id: "retired", recurrenceEndsOn: "2026-11-25" },
  { ...tomorrowChore, id: "due-today", dueDate: "2026-11-25T01:00:00Z", scheduledDate: "2026-11-24" },
  { ...tomorrowChore, id: "invalid-date", dueDate: "invalid" },
];
const upcomingSnapshot = JSON.stringify(upcomingSaved);
const selectedUpcoming = upcomingHouseholdChores(upcomingSaved, "home-a", upcomingNow, upcomingTimezone);
assert(selectedUpcoming.map((chore) => chore.id).join(",") === "upcoming-daily,upcoming-weekly,upcoming-monthly", "Upcoming must show saved future chores in due-date order, excluding completed, skipped, retired, today's, invalid, and other-household records");
assert(JSON.stringify(upcomingSaved) === upcomingSnapshot, "showing Upcoming must not change assignments, due dates, or completion");
assert(upcomingHouseholdChores(upcomingSaved, null, upcomingNow, upcomingTimezone).length === 0, "Upcoming requires an active household");
const householdMidnight = new Date("2026-11-25T05:00:00Z");
assert(upcomingHouseholdChores([tomorrowChore], "home-a", householdMidnight, upcomingTimezone).length === 0, "a chore must leave Upcoming when its household's due day begins");
assert(activeChores([tomorrowChore], householdMidnight, upcomingTimezone).length === 1, "the same saved occurrence must move into the current list without duplication");
const aroundMidnight = "2026-11-25T00:30:00Z";
const losAngelesDue = upcomingChoreDueLabel(aroundMidnight, "America/Los_Angeles");
assert(losAngelesDue.date.includes("Nov 24, 2026") && losAngelesDue.time.includes("4:30") && losAngelesDue.time.includes("PM"), "due labels must show the actual household date and time, even when the UTC date differs");
const tokyoDue = upcomingChoreDueLabel(aroundMidnight, "Asia/Tokyo");
assert(tokyoDue.date.includes("Nov 25, 2026") && tokyoDue.time.includes("9:30") && tokyoDue.time.includes("AM"), "due labels must respect a different household timezone");
const selectedTomorrow = new Date(2026, 10, 25, 12);
assert(choresActiveOnSelectedDay(upcomingSaved, selectedTomorrow, upcomingNow).filter(chore => chore.householdId === "home-a").map(chore => chore.id).sort().join(",") === "due-today,upcoming-daily", "selecting tomorrow must include its saved future chore and existing carryover, excluding later, skipped, retired, completed, and invalid rows");
assert(choresActiveOnSelectedDay([tomorrowChore], new Date(2026, 10, 24, 12), upcomingNow).length === 0, "a future chore must not be mislabeled as due today");
const ownUpcoming = upcomingHouseholdChores(upcomingSaved.filter(chore => chore.assignedTo === "member-a"), "home-a", upcomingNow, upcomingTimezone);
assert(ownUpcoming.map(chore => chore.id).join(",") === "upcoming-daily,upcoming-weekly,upcoming-monthly", "personal Upcoming must retain the actual saved due dates and monthly work before it is due");
// Group lists use the calendar's strict household week, including saved future
// chores later this week; other weeks remain available through Calendar.
const groupWeekNow = new Date("2026-11-24T18:00:00Z");
const groupWeekRows: Chore[] = [
  tomorrowChore, weeklyChore, monthlyChore,
  { ...tomorrowChore, id: "week-monday", scheduledDate: "2026-11-23", dueDate: "2026-11-23T14:00:00Z" },
  { ...tomorrowChore, id: "week-sunday", scheduledDate: "2026-11-29", dueDate: "2026-11-30T04:59:00Z" },
  { ...tomorrowChore, id: "next-monday", scheduledDate: "2026-11-30", dueDate: "2026-11-30T05:00:00Z" },
  { ...tomorrowChore, id: "older-debt", scheduledDate: "2026-11-22", dueDate: "2026-11-23T04:59:00Z" },
  { ...tomorrowChore, id: "completed-this-week", completed: true, completedAt: groupWeekNow.toISOString() },
  { ...tomorrowChore, id: "skipped-this-week", skippedAt: groupWeekNow.toISOString() },
  { ...tomorrowChore, id: "retired-this-week", recurrenceEndsOn: "2026-11-25" },
  { ...tomorrowChore, id: "other-household", householdId: "home-b" },
  { ...tomorrowChore, id: "invalid-week-date", dueDate: "invalid" },
];
const savedGroupWeekRows = JSON.stringify(groupWeekRows);
const groupWeek = currentHouseholdWeekChores(groupWeekRows, "home-a", groupWeekNow, upcomingTimezone);
assert(groupWeek.map(chore => chore.id).sort().join(",") === "completed-this-week,upcoming-daily,week-monday,week-sunday", "Group must show only Monday–Sunday saved chores, including later this week and completed work, without other weeks, skipped, retired or other-household records");
assert(JSON.stringify(groupWeekRows) === savedGroupWeekRows, "filtering Group must not delete or change saved chores, assignments or due dates");
assert(currentHouseholdWeekChores(groupWeekRows, null, groupWeekNow, upcomingTimezone).length === 0, "weekly Group chores require an active household");
const nextWeekGroup = currentHouseholdWeekChores(groupWeekRows, "home-a", new Date("2026-11-30T05:00:00Z"), upcomingTimezone);
assert(nextWeekGroup.map(chore => chore.id).sort().join(",") === "next-monday,upcoming-weekly", "the Group list must advance at household midnight on Monday");
const zoneWeekChore = { ...tomorrowChore, scheduledDate: undefined, dueDate: "2026-11-23T15:00:00Z" };
const zoneWeekNow = new Date("2026-11-23T02:00:00Z");
assert(currentHouseholdWeekChores([zoneWeekChore], "home-a", zoneWeekNow, "America/New_York").length === 0, "New York's Sunday must not include next Monday's chore");
assert(currentHouseholdWeekChores([zoneWeekChore], "home-a", zoneWeekNow, "Asia/Tokyo").length === 1, "Tokyo's Monday must already include its new household week");
console.log("Group household-week filtering and personal Upcoming visibility tests passed");
