import { scheduleDateKey, scheduleDateLabel, scheduleItemCompletionProgress, scheduleItemPeriod, scheduleItemProgress, scheduleItemsForDay, scheduleItemTimes, type PersonalScheduleItem } from "./personalSchedule.ts";
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const item: PersonalScheduleItem = { id: "event", user_id: "me", source: "google-event", resource_id: "calendar", provider_id: "event", title: "Private appointment",
  starts_at: "2026-11-24T16:00:00Z", ends_at: "2026-11-24T17:00:00Z", starts_on: null, ends_on: null, busy: true, link: null,
  app_completed_at: null, override_start: null, override_end: null, period_override: null };
const zone = "America/New_York";
assert(scheduleItemPeriod(item, zone) === "morning", "11 AM local belongs in Day");
const noon = { ...item, starts_at: "2026-11-24T17:00:00Z", ends_at: "2026-11-24T18:00:00Z" };
assert(scheduleItemPeriod(noon, zone) === "morning", "noon must stay in Day");
for (const [start, timezone, expected] of [
  ["2026-11-24T22:59:59Z", zone, "morning"],
  ["2026-11-24T23:00:00Z", zone, "night"],
  ["2026-11-25T04:59:59Z", zone, "night"],
  ["2026-11-25T05:00:00Z", zone, "morning"],
  ["2026-07-24T21:59:59Z", zone, "morning"],
  ["2026-07-24T22:00:00Z", zone, "night"],
  ["2026-11-24T23:00:00Z", "America/Los_Angeles", "morning"],
] as const) {
  const event = { ...item, starts_at: start, ends_at: new Date(Date.parse(start) + 3600000).toISOString() };
  assert(scheduleItemPeriod(event, timezone) === expected, `Day/Night must switch at 6 PM in ${timezone}: ${start}`);
}
const crossingSix = { ...item, starts_at: "2026-11-24T22:30:00Z", ends_at: "2026-11-24T23:30:00Z" };
assert(scheduleItemPeriod(crossingSix, zone) === "morning", "an event starting before 6 PM stays in Day even when it ends later");
assert(scheduleItemProgress(item, Date.parse(item.starts_at!) - 1) === null, "timers must not start early");
const started = scheduleItemProgress(item, Date.parse(item.starts_at!));
assert(started?.elapsed === 0 && started.durationMs === 3600000, "the ring must measure the entire original block");
const half = scheduleItemProgress(item, Date.parse("2026-11-24T16:30:00Z"));
assert(half?.elapsed === 0.5 && half.remainingMs === 1800000, "halfway through a block must show half a ring and 30 minutes left");
assert(scheduleItemProgress(item, Date.parse(item.ends_at!)) === null, "the timer must stop exactly at the end");
assert(scheduleItemProgress({ ...item, app_completed_at: item.starts_at }, Date.parse("2026-11-24T16:30:00Z")) === null, "completed tasks must not remain active");
const overnight = { ...item, starts_at: "2026-11-24T23:00:00Z", ends_at: "2026-11-25T13:00:00Z" };
assert(scheduleItemsForDay([overnight], "2026-11-24", zone).length === 1 && scheduleItemsForDay([overnight], "2026-11-25", zone).length === 1, "overnight blocks must appear on both local days");
assert(scheduleItemPeriod(overnight, zone, "2026-11-25") === "morning", "an overnight block already underway belongs in the following morning");
const midnight = { ...item, starts_at: "2026-11-24T23:00:00Z", ends_at: "2026-11-25T05:00:00Z" };
assert(scheduleItemsForDay([midnight], "2026-11-25", zone).length === 0, "an event ending at local midnight must not spill into the next day");
const allDay = { ...item, starts_at: null, ends_at: null, starts_on: "2026-11-24", ends_on: "2026-11-26", busy: false };
assert(scheduleItemsForDay([allDay], "2026-11-25", zone).length === 1 && scheduleItemsForDay([allDay], "2026-11-26", zone).length === 0, "all-day Google end dates are exclusive");
assert(scheduleItemProgress(allDay, Date.now()) === null, "all-day events must not get invented timers");
const task = { ...allDay, source: "google-task" as const, ends_on: null };
assert(scheduleItemsForDay([task], "2026-11-24", zone).length === 1 && scheduleItemsForDay([task], "2026-11-25", zone).length === 0, "Google Tasks dates must not shift across time zones");
assert(scheduleItemsForDay([{ ...task, starts_on: null }], "2026-11-25", zone).length === 1, "undated tasks must remain available");
assert(scheduleItemPeriod({ ...task, period_override: "night" }, zone) === "night", "untimed tasks can move to Night");
const timedTask = { ...task, override_start: "2026-11-24T19:00:00Z", override_end: "2026-11-24T20:00:00Z", period_override: "morning" as const };
assert(scheduleItemTimes(timedTask).start === timedTask.override_start && scheduleItemPeriod(timedTask, zone) === "morning", "an afternoon task must stay in Day using its actual time block");
const eveningTask = { ...timedTask, override_start: "2026-11-24T23:00:00Z", override_end: "2026-11-25T00:00:00Z" };
assert(scheduleItemPeriod(eveningTask, zone) === "night", "a task starting at 6 PM belongs in Night");
assert(scheduleDateKey(new Date("2026-11-01T05:30:00Z"), zone) === "2026-11-01" && scheduleDateKey(new Date("2026-11-01T06:30:00Z"), zone) === "2026-11-01", "fall-back clock changes must keep the correct local day");
console.log("Personal schedule 6 PM grouping, full-block timers, time zones, overnight events, and task override tests passed");

assert(scheduleItemCompletionProgress(item, Date.parse(item.starts_at!) - 1) === 0, "a future time block has an empty check ring");
assert(scheduleItemCompletionProgress(item, Date.parse("2026-11-24T16:30:00Z")) === 0.5, "an active time block fills the checkbox ring halfway");
assert(scheduleItemCompletionProgress(item, Date.parse(item.ends_at!)) === 1, "a finished time block fills its elapsed ring without automatically checking the item");
assert(scheduleItemCompletionProgress({ ...item, app_completed_at: item.starts_at }, Date.parse(item.starts_at!)) === 1, "checking an item fills the ring immediately");
assert(scheduleItemCompletionProgress(task, Date.now()) === 0 && scheduleItemCompletionProgress({ ...task, app_completed_at: item.starts_at }, Date.now()) === 1, "untimed items move from empty to full only when checked");
assert(scheduleItemCompletionProgress(timedTask, Date.parse("2026-11-24T19:30:00Z")) === 0.5, "scheduled task rings use their local time override");
assert(scheduleDateLabel(item, zone) === "Nov 24, 2026", "event details use the display time zone");
assert(scheduleDateLabel(overnight, zone) === "Nov 24, 2026 – Nov 25, 2026", "overnight details show both dates");
assert(scheduleDateLabel(midnight, zone) === "Nov 24, 2026", "an exclusive midnight ending does not add a date");
assert(scheduleDateLabel(allDay, zone) === "Nov 24, 2026 – Nov 25, 2026", "all-day detail ranges respect exclusive Google end dates");
assert(scheduleDateLabel({ ...task, starts_on: null }, zone) === "No date", "undated tasks still have useful details");
console.log("Imported item details date ranges and checkbox time-progress rings passed.");
