import { chartRestartAlerts, mergeChartRestartAlerts } from "./chartRestartAlerts.ts";
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


const restartRows = [{ id: "restart-event", household_id: "home", chart_id: "new-review", actor_id: "avery", actor_name: "Avery", recipient_id: "blake", created_at: "2026-11-24T18:00:00Z", read_at: null }];
const blakeRestartAlerts = chartRestartAlerts(restartRows, "home", "blake");
assert(blakeRestartAlerts.length === 1 && blakeRestartAlerts[0].recipientId === "blake", "the other roommate must receive the restart alert");
assert(chartRestartAlerts(restartRows, "home", "avery").length === 0, "the roommate restarting the chart must not receive their own alert");
assert(chartRestartAlerts(restartRows, "other-home", "blake").length === 0, "restart alerts must remain inside their household");
assert(blakeRestartAlerts[0].relatedEntityId === "new-review" && blakeRestartAlerts[0].message.includes("Avery"), "the restart alert must identify who restarted the review and link its chart");
const deliveredAgain = mergeChartRestartAlerts(blakeRestartAlerts, blakeRestartAlerts);
assert(deliveredAgain === blakeRestartAlerts, "realtime delivery and later reopening must not duplicate the same alert");
const readOnAnotherDevice = chartRestartAlerts([{ ...restartRows[0], read_at: "2026-11-24T18:01:00Z" }], "home", "blake");
const mergedRead = mergeChartRestartAlerts(blakeRestartAlerts, readOnAnotherDevice);
assert(mergedRead[0].readAt === "2026-11-24T18:01:00Z", "a read receipt must follow the recipient between devices");
assert(mergeChartRestartAlerts(mergedRead, blakeRestartAlerts)[0].readAt === mergedRead[0].readAt, "an older unread response must not undo a read receipt");
console.log("Chart restart recipient notification tests passed");
