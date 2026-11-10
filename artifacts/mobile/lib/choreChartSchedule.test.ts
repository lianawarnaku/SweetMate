import type { Chore } from "../context/AppContext";
import {
  choreChartWeekStart,
  selectChoreChartWeek,
  groupChoreChartWeeks,
  projectChoreChartSchedule,
} from "./choreChartSchedule.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}
function chore(extra: Partial<Chore> = {}): Chore {
  return {
    id: "daily-first",
    householdId: "house",
    title: "Dishes",
    assignedTo: "a",
    assignmentMode: "round-robin",
    roundRobinParticipantIds: ["a", "b", "c"],
    roundRobinAllMembers: false,
    roundRobinCursor: 0,
    dueDate: "2026-11-09T12:00:00.000Z",
    scheduledDate: "2026-11-09",
    initialScheduledDate: "2026-11-09",
    recurrenceSeriesId: "dishes-series",
    recurring: "daily",
    completed: false,
    points: 10,
    category: "kitchen",
    ...extra,
  };
}
const roster = ["a", "b", "c"];
const seed = chore();
const before = JSON.stringify(seed);
const daily = projectChoreChartSchedule(
  [seed],
  roster,
  "2026-11-09",
  "2026-11-15",
  "2026-11-09",
);
assert(
  daily.length === 7 &&
    daily.map((entry) => entry.assignedTo).join(",") === "a,b,c,a,b,c,a",
  "daily chores must show every occurrence and rotate within a single week",
);
assert(
  !daily[0].projected && daily.slice(1).every((entry) => entry.projected),
  "saved occurrences and read-only future projections must remain distinguishable",
);
assert(
  JSON.stringify(seed) === before,
  "calendar projection must not mutate or materialize household state",
);
const week = groupChoreChartWeeks(daily)[0];
assert(
  week.startsOn === "2026-11-09" && week.endsOn === "2026-11-15",
  "calendar weeks must run Monday through Sunday",
);
assert(
  week.rows.length === 1 && week.rows[0].occurrenceCount === 7,
  "one recurring task must have one weekly summary row",
);
assert(
  week.rows[0].assignees
    .map((entry) => `${entry.memberId}:${entry.dates.length}`)
    .join(",") === "a:3,b:2,c:2",
  "weekly task rows must show all assigned roommates with their actual occurrence counts",
);
assert(
  choreChartWeekStart("2026-11-15") === "2026-11-09",
  "Sunday must stay in the preceding Monday's week",
);

const everyThreeDays = projectChoreChartSchedule(
  [chore({ recurring: "everyThreeDays" })],
  roster,
  "2026-11-09",
  "2026-11-19",
  "2026-11-09",
);
assert(
  everyThreeDays.map((entry) => entry.scheduledDate).join(",") ===
    "2026-11-09,2026-11-12,2026-11-15,2026-11-18",
  "every-three-day tasks must retain their exact cadence",
);
const biweekly = projectChoreChartSchedule(
  [chore({ recurring: "biweekly" })],
  roster,
  "2026-11-09",
  "2026-12-08",
  "2026-11-09",
);
assert(
  biweekly.map((entry) => entry.scheduledDate).join(",") ===
    "2026-11-09,2026-11-23,2026-12-07",
  "biweekly tasks must not appear every week",
);
const monthly = projectChoreChartSchedule(
  [
    chore({
      recurring: "monthly",
      dueDate: "2026-01-31T12:00:00Z",
      scheduledDate: "2026-01-31",
      initialScheduledDate: "2026-01-31",
      monthlyAnchorDay: 31,
    }),
  ],
  roster,
  "2026-01-01",
  "2026-04-30",
  "2026-01-01",
);
assert(
  monthly.map((entry) => entry.scheduledDate).join(",") ===
    "2026-01-31,2026-02-28,2026-03-31,2026-04-30",
  "monthly projection must clamp short months and recover the original anchor day",
);
const monthlyFastForward = projectChoreChartSchedule(
  [
    chore({
      recurring: "monthly",
      dueDate: "2026-01-31T12:00:00Z",
      scheduledDate: "2026-01-31",
      initialScheduledDate: "2026-01-31",
      monthlyAnchorDay: 31,
    }),
  ],
  roster,
  "2026-03-01",
  "2026-04-30",
  "2026-03-01",
);
assert(
  monthlyFastForward
    .map((entry) => `${entry.scheduledDate}:${entry.assignedTo}`)
    .join(",") === "2026-03-31:c,2026-04-30:a",
  "fast-forwarding must preserve both monthly cadence and rotation position",
);

const exclusions = projectChoreChartSchedule(
  [chore({ excludedOccurrenceDates: ["2026-11-10"] })],
  roster,
  "2026-11-09",
  "2026-11-12",
  "2026-11-09",
);
assert(
  exclusions
    .map((entry) => `${entry.scheduledDate}:${entry.assignedTo}`)
    .join(",") === "2026-11-09:a,2026-11-11:c,2026-11-12:a",
  "deleted occurrences must stay absent without shifting later rotation positions",
);
const rosterChange = projectChoreChartSchedule(
  [
    chore({
      roundRobinAllMembers: true,
      excludedParticipantIds: ["b"],
    }),
  ],
  ["a", "b", "d"],
  "2026-11-09",
  "2026-11-12",
  "2026-11-09",
);
assert(
  rosterChange.map((entry) => entry.assignedTo).join(",") === "a,d,a,d",
  "future rotation must remove departed/excluded roommates and include new active roommates when all-members mode is enabled",
);
const fixedRoster = projectChoreChartSchedule(
  [seed],
  ["a", "c", "d"],
  "2026-11-09",
  "2026-11-12",
  "2026-11-09",
);
assert(
  fixedRoster.map((entry) => entry.assignedTo).join(",") === "a,c,a,c",
  "a selected-participants rotation must not silently add a new roommate",
);
const departed = projectChoreChartSchedule(
  [seed],
  ["b", "c"],
  "2026-11-09",
  "2026-11-11",
  "2026-11-09",
);
assert(
  departed.map((entry) => entry.assignedTo).join(",") === "a,b,c",
  "stored assignment remains intact and the next occurrence starts with the first eligible roommate after its assignee leaves",
);
const noEligible = projectChoreChartSchedule(
  [chore({ excludedParticipantIds: roster })],
  roster,
  "2026-11-09",
  "2026-11-10",
  "2026-11-09",
);
assert(
  noEligible[1].assignedTo === "unassigned",
  "no eligible future assignee must be shown as unassigned instead of reviving an excluded person",
);
const pinned = projectChoreChartSchedule(
  [chore({ assignmentMode: "specific-person", assignmentLocked: true })],
  roster,
  "2026-11-09",
  "2026-11-12",
  "2026-11-09",
);
assert(
  pinned.every((entry) => entry.assignedTo === "a"),
  "a specific-person assignment must remain pinned on every recurrence",
);

const stopped = projectChoreChartSchedule(
  [
    chore({ recurrenceEndsOn: "2026-11-12" }),
    chore({
      id: "done",
      scheduledDate: "2026-11-13",
      completed: true,
      assignedTo: "former",
      recurrenceEndsOn: "2026-11-12",
    }),
    chore({
      id: "stale-future",
      scheduledDate: "2026-11-14",
      recurrenceEndsOn: "2026-11-12",
    }),
  ],
  roster,
  "2026-11-09",
  "2026-11-15",
  "2026-11-09",
);
assert(
  stopped.map((entry) => entry.scheduledDate).join(",") ===
    "2026-11-09,2026-11-10,2026-11-11,2026-11-13",
  "ended series must not forecast or show stale unfinished rows beyond their cutoff, while preserving completed history",
);
assert(
  stopped.at(-1)?.assignedTo === "former",
  "completed historical ownership must survive roster changes",
);
const deletedSeries = projectChoreChartSchedule(
  [chore({ completed: true, recurrenceEndsOn: "2026-11-09" })],
  roster,
  "2026-11-09",
  "2026-11-15",
  "2026-11-09",
);
assert(
  deletedSeries.length === 1 && !deletedSeries[0].projected,
  "deleting a series must not resurrect it from a retained completed occurrence",
);

const explicit = projectChoreChartSchedule(
  [
    seed,
    chore({
      id: "explicit",
      scheduledDate: "2026-11-12",
      assignedTo: "c",
      roundRobinCursor: 2,
    }),
  ],
  roster,
  "2026-11-09",
  "2026-11-14",
  "2026-11-09",
);
assert(
  explicit.find((entry) => entry.scheduledDate === "2026-11-12")?.assignedTo ===
    "c" &&
    explicit.find((entry) => entry.scheduledDate === "2026-11-13")
      ?.assignedTo === "a",
  "saved future assignments must override a forecast and anchor the following rotation",
);
const duplicate = projectChoreChartSchedule(
  [seed, chore({ id: "duplicate-done", completed: true, assignedTo: "b" })],
  roster,
  "2026-11-09",
  "2026-11-09",
  "2026-11-09",
);
assert(
  duplicate.length === 1 &&
    duplicate[0].completed &&
    duplicate[0].assignedTo === "b",
  "stored duplicates must resolve to completed history and appear only once",
);
const legacy = projectChoreChartSchedule(
  [
    chore({
      id: "old-root",
      recurrenceSeriesId: undefined,
      nextOccurrenceId: "old-child",
    }),
    chore({
      id: "old-child",
      recurrenceSeriesId: undefined,
      scheduledDate: "2026-11-10",
      assignedTo: "b",
    }),
  ],
  roster,
  "2026-11-09",
  "2026-11-11",
  "2026-11-09",
);
assert(
  legacy.length === 3 &&
    new Set(legacy.map((entry) => entry.seriesId)).size === 1,
  "legacy next-occurrence links must not turn into duplicate independent series",
);
const manual = projectChoreChartSchedule(
  [
    chore({
      recurring: undefined,
      recurrenceSeriesId: undefined,
      assignmentMode: "specific-person",
    }),
  ],
  roster,
  "2026-11-01",
  "2026-11-30",
  "2026-11-09",
);
assert(
  manual.length === 1 && !manual[0].projected,
  "manual one-time chores must appear without needing any generated chart object",
);
const noInventedHistory = projectChoreChartSchedule(
  [chore({ scheduledDate: "2026-11-01" })],
  roster,
  "2026-11-01",
  "2026-11-10",
  "2026-11-09",
);
assert(
  noInventedHistory.map((entry) => entry.scheduledDate).join(",") ===
    "2026-11-01,2026-11-09,2026-11-10",
  "past calendar history must only come from saved occurrences",
);
const oldSeed = projectChoreChartSchedule(
  [chore({ scheduledDate: "2000-01-01", dueDate: "2000-01-01T12:00:00Z" })],
  roster,
  "2060-11-09",
  "2060-11-15",
  "2060-11-09",
);
assert(
  oldSeed.length === 7,
  "a long-lived series must fast-forward without exhausting the recurrence preview guard",
);
assert(
  projectChoreChartSchedule(
    [seed],
    roster,
    "2026-02-31",
    "2026-11-10",
    "2026-11-09",
  ).length === 0,
  "invalid calendar dates must not produce a misleading schedule",
);

const departedMiddle = projectChoreChartSchedule(
  [chore({ assignedTo: "b", roundRobinCursor: 1 })],
  ["a", "c"],
  "2026-11-09",
  "2026-11-12",
  "2026-11-09",
);
assert(
  departedMiddle.map((entry) => entry.assignedTo).join(",") === "b,c,a,c",
  "the next old surviving successor must follow a departing middle-roster owner",
);
const departedDeletedSlot = projectChoreChartSchedule(
  [
    chore({
      assignedTo: "b",
      roundRobinCursor: 1,
      excludedOccurrenceDates: ["2026-11-10"],
    }),
  ],
  ["a", "c"],
  "2026-11-09",
  "2026-11-12",
  "2026-11-09",
);
assert(
  departedDeletedSlot
    .map((entry) => `${entry.scheduledDate}:${entry.assignedTo}`)
    .join(",") === "2026-11-09:b,2026-11-11:a,2026-11-12:c",
  "deleted scheduled slots must still advance the shared rotation after a roster change",
);

// A calendar selection must never leak chores from another displayed week.
const selectableWeeks = groupChoreChartWeeks(projectChoreChartSchedule(
  [seed], roster, "2026-11-01", "2026-12-13", "2026-11-09",
));
for (const [date, start, end] of [
  ["2026-11-09", "2026-11-09", "2026-11-15"],
  ["2026-11-15", "2026-11-09", "2026-11-15"],
  ["2026-11-16", "2026-11-16", "2026-11-22"],
  ["2026-12-01", "2026-11-30", "2026-12-06"],
]) {
  const selected = selectChoreChartWeek(selectableWeeks, date);
  assert(selected.startsOn === start && selected.endsOn === end, `selecting ${date} must show its Monday–Sunday week`);
  assert(selected.rows.length > 0, "the selected scheduled week must contain its chores");
  assert(selected.rows.every((row) => row.assignees.every((assignee) => assignee.dates.every((day) => day >= start && day <= end))), "only selected-week occurrences may be displayed");
}
const emptySelection = selectChoreChartWeek(selectableWeeks, "2027-01-01");
assert(emptySelection.startsOn === "2026-12-28" && emptySelection.endsOn === "2027-01-03" && emptySelection.rows.length === 0, "an empty week across a year boundary must remain selected without falling back to other chores");
console.log("group calendar week selection tests passed");
