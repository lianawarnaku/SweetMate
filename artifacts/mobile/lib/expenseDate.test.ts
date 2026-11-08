import assert from "node:assert/strict";
import { expenseDateInputValue, formatExpenseDate, normalizeExpenseDate, parseExpenseDate } from "./expenseDate.ts";

const originalZone = process.env.TZ;
try {
  for (const zone of ["America/New_York", "Pacific/Auckland", "UTC"]) {
    process.env.TZ = zone;
    assert.equal(normalizeExpenseDate("2026-11-08"), "2026-11-08");
    assert.equal(formatExpenseDate("2026-11-08"), "Nov 8", zone);
    assert.equal(formatExpenseDate("2026-11-08T00:00:00.000Z"), "Nov 8", "legacy dates preserve the written financial calendar day");
    const localNoon = parseExpenseDate("2026-11-08")!;
    assert.equal(localNoon.getDate(), 8);
    assert.equal(localNoon.getMonth(), 10);
    assert.equal(localNoon.getHours(), 12);
    assert.equal(expenseDateInputValue(localNoon), "2026-11-08");
    assert.equal(normalizeExpenseDate(localNoon), "2026-11-08", "saving local noon never converts to an adjacent UTC day");
    for (const day of ["2026-03-08", "2026-11-01", "2026-09-27", "2026-04-05"]) {
      assert.equal(normalizeExpenseDate(parseExpenseDate(day)!), day, `DST date round-trip: ${zone} ${day}`);
    }
  }
} finally {
  if (originalZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalZone;
}
assert.equal(normalizeExpenseDate("2024-02-29"), "2024-02-29");
for (const invalid of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-00-01", "2026-11-00", "11/08/2026", "2026-11-08oops", "2026-11-08T99:99:00Z", ""]) {
  assert.equal(normalizeExpenseDate(invalid), null, invalid);
  assert.equal(parseExpenseDate(invalid), null, invalid);
  assert.equal(formatExpenseDate(invalid), "", invalid);
}
assert.equal(normalizeExpenseDate(new Date(NaN)), null);
console.log("expense date tests passed");
