import assert from "node:assert/strict";
import {
  buildChoreCalendarEvent,
  calendarDate,
  googleEventId,
} from "./choreCalendarEvent.ts";

assert.equal(calendarDate("2028-02-29T23:30:00-05:00"), "2028-02-29");
assert.equal(calendarDate("2027-02-29"), null);
assert.equal(googleEventId("occurrence-1"), googleEventId("occurrence-1"));
assert.notEqual(googleEventId("occurrence-1"), googleEventId("occurrence-2"));

const event = buildChoreCalendarEvent({
  choreId: "series-4:2028-03-12",
  title: "Take out recycling",
  dueDate: "2028-03-12T12:00:00-04:00",
  assignee: "Liana",
  household: "Maple House",
});

assert.equal(event.start.date, "2028-03-12");
assert.equal(event.end.date, "2028-03-13");
assert.equal(
  event.extendedProperties.private.sweetmateChoreOccurrenceId,
  "series-4:2028-03-12",
);
assert.match(event.description, /Assigned to: Liana/);
assert.match(event.description, /Sweet: Maple House/);
