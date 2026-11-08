import type { Chore } from "../context/AppContext";
import {
  advanceChoreDueDate,
  advanceScheduledDate,
  CHORE_RECURRENCE_LABELS,
  initialIntervalDaysFor,
  resolveRoundRobinParticipants,
  roundRobinAssigneeAfter,
} from "./choreSchedule.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const base = new Date(2026, 0, 31, 23, 59).toISOString();
const monthly = new Date(advanceChoreDueDate(base, "monthly"));
assert(monthly.getMonth() === 1 && monthly.getDate() === 28, "monthly recurrence must clamp Jan 31 to Feb 28");

const leapBase = new Date(2028, 0, 31, 23, 59).toISOString();
const leapMonthly = new Date(advanceChoreDueDate(leapBase, "monthly"));
assert(leapMonthly.getMonth() === 1 && leapMonthly.getDate() === 29, "monthly recurrence must clamp to leap day");
assert(
  advanceScheduledDate(
    advanceScheduledDate("2026-01-31", "monthly", 31),
    "monthly",
    31,
  ) === "2026-03-31",
  "monthly clamping must return to the anchored day after a short month",
);
assert(
  advanceScheduledDate("2028-01-31", "monthly", 31) === "2028-02-29",
  "date-only monthly calculation must support leap years",
);
assert(
  advanceScheduledDate("2026-12-15", "monthly", 15) === "2027-01-15",
  "monthly recurrence must cross year boundaries",
);
assert(
  advanceScheduledDate("2026-07-27", "weekly") === "2026-08-03" &&
    advanceScheduledDate("2026-07-27", "biweekly") === "2026-08-10",
  "weekly and biweekly schedules must preserve their interval across month boundaries",
);
assert(
  advanceScheduledDate("2026-07-27", "everyOtherDay") === "2026-07-29",
  "everyOtherDay must step by two days, distinct from daily or weekly",
);

// Regression for the planner's daily/everyOtherDay/weekly/biweekly mismatch:
// each recurrence must have its own initial due-date offset instead of
// collapsing everyOtherDay into daily's offset or biweekly into weekly's.
assert(
  initialIntervalDaysFor("daily") === 1 &&
    initialIntervalDaysFor("everyOtherDay") === 2 &&
    initialIntervalDaysFor("everyThreeDays") === 3 &&
    initialIntervalDaysFor("weekly") === 7 &&
    initialIntervalDaysFor("biweekly") === 14 &&
    initialIntervalDaysFor("monthly") === 30,
  "each recurrence must have a distinct, correct initial interval",
);
assert(
  Object.keys(CHORE_RECURRENCE_LABELS).length === 6 &&
    CHORE_RECURRENCE_LABELS.everyOtherDay === "Every other day",
  "every recurrence value must have a human-readable display label",
);

const sunday = new Date(2026, 6, 26, 23, 59).toISOString();
const weekly = new Date(advanceChoreDueDate(sunday, "weekly"));
assert(weekly.getDay() === 0 && weekly.getDate() === 2, "weekly recurrence must preserve weekday across month boundaries");

const chore: Chore = {
  id: "series",
  title: "Clean",
  assignedTo: "a",
  dueDate: base,
  completed: false,
  points: 10,
  category: "cleaning",
  assignmentMode: "round-robin",
  roundRobinAllMembers: true,
  roundRobinParticipantIds: ["b", "removed", "a"],
  excludedParticipantIds: ["c"],
};
const participants = resolveRoundRobinParticipants(chore, ["a", "b", "c", "d"]);
assert(participants.join(",") === "b,a,d", "rotation must remove inactive/excluded members and append active members");

const fixed = resolveRoundRobinParticipants(
  { ...chore, roundRobinAllMembers: false },
  ["a", "b", "c", "d"],
);
assert(fixed.join(",") === "b,a", "fixed rotations must not add new household members");

assert(
  advanceScheduledDate("2026-07-30", "everyThreeDays") === "2026-08-02" &&
    advanceChoreDueDate("2026-07-30T12:00:00.000Z", "everyThreeDays") === "2026-08-02T12:00:00.000Z" &&
    CHORE_RECURRENCE_LABELS.everyThreeDays === "Every 3 days",
  "every-three-days cadence must stay exact in date-only schedules, persisted due dates and labels",
);

assert(
  advanceChoreDueDate("2026-03-07T14:15:32.125Z", "daily", undefined, "America/New_York") === "2026-03-08T13:15:32.125Z",
  "completion-created next occurrences must preserve the household clock across spring DST",
);
assert(
  advanceChoreDueDate("2026-10-31T13:15:32.125Z", "daily", undefined, "America/New_York") === "2026-11-01T14:15:32.125Z",
  "completion-created next occurrences must preserve the household clock across fall DST",
);
assert(
  advanceChoreDueDate(advanceChoreDueDate("2026-01-31T14:00:00.000Z", "monthly", 31, "America/New_York"), "monthly", 31, "America/New_York") === "2026-03-31T13:00:00.000Z",
  "timezone-aware monthly completion must retain its anchor through February and DST",
);

const rotationSeed: Chore = { ...chore, assignedTo: "b", roundRobinParticipantIds: ["a", "b", "c"], excludedParticipantIds: [], roundRobinCursor: 1 };
assert(roundRobinAssigneeAfter(rotationSeed, ["a", "b", "c"]) === "c", "shared rotation must advance from the actual current assignee");
assert(roundRobinAssigneeAfter(rotationSeed, ["a", "b", "c"], 2) === "a", "multiple scheduled turns must retain their positions");
assert(roundRobinAssigneeAfter(rotationSeed, ["a", "c"]) === "c", "a departing owner must hand off to the next surviving old successor");
assert(roundRobinAssigneeAfter(rotationSeed, ["a", "c"], 2) === "a", "deleted scheduled positions must still count after a departure");
assert(roundRobinAssigneeAfter({ ...rotationSeed, assignedTo: "c" }, ["a", "b", "c", "d"]) === "d", "new members must join an all-members rotation");
assert(roundRobinAssigneeAfter({ ...rotationSeed, assignedTo: "c", roundRobinAllMembers: false }, ["a", "b", "c", "d"]) === "a", "new members must not enter a fixed cohort");
assert(roundRobinAssigneeAfter({ ...rotationSeed, assignedTo: "a", excludedParticipantIds: ["b"] }, ["a", "b", "c"]) === "c", "Never-me exclusions must apply to shared rotation");
assert(roundRobinAssigneeAfter({ ...rotationSeed, assignmentMode: "specific-person" }, ["a", "b", "c"], 3) === "b", "an active specific-person pin must stay fixed");
assert(roundRobinAssigneeAfter({ ...rotationSeed, assignmentMode: "specific-person" }, ["a", "c"]) === undefined, "a departed pinned owner must need review");
assert(roundRobinAssigneeAfter(rotationSeed, []) === undefined, "empty active rosters must not invent an eligible assignee");
