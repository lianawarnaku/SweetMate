import assert from "node:assert/strict";
import { choreDueLabel } from "./choreDueLabel.ts";
const original = process.env.TZ;
try {
  for (const timezone of ["America/New_York", "America/Los_Angeles", "Asia/Tokyo", "UTC"]) {
    process.env.TZ = timezone;
    for (const hour of [0, 6, 12, 23]) {
      const now = new Date(2026, 10, 26, hour);
      assert.equal(choreDueLabel(new Date(2026, 10, 26, 23, 59).toISOString(), now), "Today");
      assert.equal(choreDueLabel(new Date(2026, 10, 27, 0, 1).toISOString(), now), "Tomorrow");
      assert.match(choreDueLabel(new Date(2026, 10, 25, 23, 59).toISOString(), now), /^Overdue/);
    }
    assert.equal(choreDueLabel(new Date(2026, 2, 9).toISOString(), new Date(2026, 2, 7, 23)), "2d left");
  }
} finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
console.log("Chore due labels use calendar days across times, timezones and DST");
