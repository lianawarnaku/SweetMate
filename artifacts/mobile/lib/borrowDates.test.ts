import assert from "node:assert/strict";
import { borrowDateInput, borrowDaysUntil } from "./borrowDates.ts";
const original = process.env.TZ;
try {
  for (const zone of ["America/New_York", "America/Los_Angeles", "Asia/Tokyo", "UTC"]) {
    process.env.TZ = zone;
    for (const input of ["2026-11-26", "2026-03-08", "2026-11-01", "2028-02-29"]) {
      const [year, month, day] = input.split("-").map(Number);
      for (const hour of [0, 12, 23]) {
        const saved = new Date(year, month - 1, day, hour, 59).toISOString();
        assert.equal(borrowDateInput(saved), input, "editing cannot shift a borrowed/due date through UTC");
        assert.equal(borrowDaysUntil(saved, new Date(year, month - 1, day, 8)), 0, "time of day cannot turn today's due date into tomorrow");
      }
    }
    const morning = new Date(2026, 10, 26, 8);
    assert.equal(borrowDateInput(morning, 7), "2026-12-03");
    assert.equal(borrowDaysUntil(new Date(2026, 11, 3, 23, 59).toISOString(), morning), 7);
    assert.equal(borrowDaysUntil(new Date(2026, 2, 9, 23, 59).toISOString(), new Date(2026, 2, 7, 8)), 2);
  }
} finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
assert.equal(borrowDateInput("invalid"), "");
console.log("Borrow date editing, calendar-day labels, timezones, leap days and DST tests passed");
