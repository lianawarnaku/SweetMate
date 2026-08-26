import type { Chore } from "../context/AppContext";
import {
  activeChores,
  ARCHIVE_INCOMPLETE_AFTER_DAYS,
  completedRetentionBoundary,
  isActiveChore,
  isArchivedIncomplete,
  isChoreInCurrentWeek,
  isRecentlyCompleted,
  startOfLocalWeek,
} from "./choreLifecycle.ts";
import { isChoreActiveOnDay } from "./choreOccurrences.ts";

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
