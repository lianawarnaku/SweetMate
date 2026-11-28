import assert from "node:assert/strict";
import { householdDueDate, householdDateKey } from "./choreTimezone.ts";
import { advanceChoreDueDate } from "./choreSchedule.ts";
import { scheduleItemPeriod, scheduleItemsForDay, type PersonalScheduleItem } from "./personalSchedule.ts";
import { upcomingHouseholdChores } from "./upcomingChores.ts";
import { currentHouseholdWeekChores } from "./groupChores.ts";
import type { Chore } from "../context/AppContext";
const zones = ["America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Asia/Kathmandu", "Australia/Lord_Howe", "Pacific/Kiritimati"];
const original = process.env.TZ;
const event: PersonalScheduleItem = { id: "event", user_id: "me", source: "google-event", resource_id: "cal", provider_id: "event", title: "Boundary fixture", starts_at: null, ends_at: null, starts_on: null, ends_on: null, busy: true, link: null, app_completed_at: null, override_start: null, override_end: null, period_override: null };
let checks = 0;
try {
  for (const device of ["UTC", "America/New_York", "Pacific/Honolulu"]) {
    process.env.TZ = device;
    for (const zone of zones) {
      for (const date of ["2026-03-08", "2026-11-01", "2026-10-04", "2026-12-31", "2028-02-29"]) {
        for (const [hour, minute, expected] of [[0, 0, "morning"], [17, 59, "morning"], [18, 0, "night"], [23, 59, "night"]] as const) {
          const start = householdDueDate(date, hour, zone, minute);
          assert.equal(householdDateKey(new Date(start), zone), date);
          assert.equal(scheduleItemPeriod({ ...event, starts_at: start }, zone, date), expected, `${device}/${zone}/${date}/${hour}:${minute}`);
          checks++;
        }
      }
      let next = householdDueDate("2028-01-31", 18, zone);
      for (const date of ["2028-02-29", "2028-03-31", "2028-04-30", "2028-05-31"]) {
        next = advanceChoreDueDate(next, "monthly", 31, zone);
        assert.equal(next, householdDueDate(date, 18, zone)); checks++;
      }
      const midnight = householdDueDate("2026-11-30", 0, zone);
      const previous = householdDueDate("2026-11-29", 23, zone, 30);
      const endsMidnight = { ...event, starts_at: previous, ends_at: midnight };
      assert.equal(scheduleItemsForDay([endsMidnight], "2026-11-29", zone).length, 1);
      assert.equal(scheduleItemsForDay([endsMidnight], "2026-11-30", zone).length, 0);
      const crossesMidnight = { ...endsMidnight, ends_at: householdDueDate("2026-11-30", 0, zone, 30) };
      assert.equal(scheduleItemsForDay([crossesMidnight], "2026-11-30", zone).length, 1);
      assert.equal(scheduleItemPeriod(crossesMidnight, zone, "2026-11-30"), "morning");
      const allDay = { ...event, starts_on: "2026-11-29", ends_on: "2026-11-30" };
      assert.equal(scheduleItemsForDay([allDay], "2026-11-29", zone).length, 1);
      assert.equal(scheduleItemsForDay([allDay], "2026-11-30", zone).length, 0);
      const chore: Chore = { id: "monday", householdId: "home", title: "Monday chore", assignedTo: "me", dueDate: householdDueDate("2026-11-30", 18, zone), scheduledDate: "2026-11-30", completed: false, points: 10, category: "other" };
      const before = new Date(Date.parse(midnight) - 1), after = new Date(midnight);
      assert.equal(upcomingHouseholdChores([chore], "home", before, zone).length, 1);
      assert.equal(upcomingHouseholdChores([chore], "home", after, zone).length, 0);
      assert.equal(currentHouseholdWeekChores([chore], "home", before, zone).length, 0);
      assert.equal(currentHouseholdWeekChores([chore], "home", after, zone).length, 1);
      checks += 10;
    }
  }
} finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
console.log(`Date reliability matrix passed: ${checks} boundary cases, 6 household zones and 3 device zones.`);
