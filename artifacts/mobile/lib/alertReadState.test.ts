import { strict as assert } from "node:assert";

import { markVisibleAlertsRead } from "./alertReadState.ts";

const readAt = "2026-09-06T12:00:00.000Z";
const existingReadAt = "2026-09-05T12:00:00.000Z";
const alerts = [
  { id: "global", title: "Global" },
  { id: "mine", title: "Mine", recipientId: "member-a" },
  { id: "theirs", title: "Theirs", recipientId: "member-b" },
  { id: "already-read", title: "Read", recipientId: "member-a", readAt: existingReadAt },
];

const result = markVisibleAlertsRead(alerts, "member-a", readAt);

assert.equal(result.find((alert) => alert.id === "global")?.readAt, readAt);
assert.equal(result.find((alert) => alert.id === "mine")?.readAt, readAt);
assert.equal(result.find((alert) => alert.id === "theirs")?.readAt, undefined);
assert.equal(result.find((alert) => alert.id === "already-read")?.readAt, existingReadAt);

console.log("alert read state tests passed");
