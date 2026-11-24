import { scheduleDateKey, scheduleItemPeriod, scheduleItemProgress, scheduleItemsForDay, scheduleItemTimes, type PersonalScheduleItem } from "./personalSchedule.ts";
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const item: PersonalScheduleItem = { id: "event", user_id: "me", source: "google-event", resource_id: "calendar", provider_id: "event", title: "Private appointment",
  starts_at: "2026-11-24T16:00:00Z", ends_at: "2026-11-24T17:00:00Z", starts_on: null, ends_on: null, busy: true, link: null,
  app_completed_at: null, override_start: null, override_end: null, period_override: null };
const zone = "America/New_York";
assert(scheduleItemPeriod(item, zone) === "morning", "11 AM local must be Morning");
const noon = { ...item, starts_at: "2026-11-24T17:00:00Z", ends_at: "2026-11-24T18:00:00Z" };
assert(scheduleItemPeriod(noon, zone) === "night", "noon must begin Night");
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
assert(scheduleItemTimes(timedTask).start === timedTask.override_start && scheduleItemPeriod(timedTask, zone) === "night", "an explicitly scheduled task must use its actual block time");
assert(scheduleDateKey(new Date("2026-11-01T05:30:00Z"), zone) === "2026-11-01" && scheduleDateKey(new Date("2026-11-01T06:30:00Z"), zone) === "2026-11-01", "fall-back clock changes must keep the correct local day");
console.log("Personal schedule noon grouping, full-block timers, time zones, overnight events, and task override tests passed");
