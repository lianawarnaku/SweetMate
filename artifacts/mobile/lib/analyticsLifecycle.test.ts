import assert from "node:assert/strict";
import { AnalyticsLifecycle, analyticsScreenForPath, type LifecycleEvent } from "./analyticsLifecycle.ts";

const initial = {
  scope: "anonymous", ready: true, consented: false, foreground: true,
  screen: "authentication" as const,
};
const totalSeconds = (events: LifecycleEvent[]) => events.reduce((sum, event) =>
  sum + (event.event === "app_active_time" ? event.properties.duration_seconds : 0), 0);

// A person may spend minutes looking at auth before opting in. None of those
// minutes, navigation, or opens may be reconstructed as analytics later.
const consent = new AnalyticsLifecycle();
assert.deepEqual(consent.update(initial, 0), []);
assert.deepEqual(consent.checkpoint(120_000), []);
assert.deepEqual(consent.update({ ...initial, ready: false, consented: true }, 120_000), []);
assert.deepEqual(consent.update({ ...initial, consented: true }, 121_000), [
  { event: "app_opened", properties: { launch_type: "consent" } },
  { event: "screen_viewed", properties: { screen: "authentication" } },
]);
assert.equal(totalSeconds(consent.checkpoint(151_500)), 30);
assert.equal(totalSeconds(consent.checkpoint(151_500)), 0, "checkpoint must not double count");
assert.deepEqual(consent.update({ ...initial, consented: true }, 152_000), [], "rerenders are not visits");
assert.deepEqual(consent.update({ ...initial, consented: true, screen: "shopping" }, 153_000), [
  { event: "screen_viewed", properties: { screen: "shopping" } },
]);
assert.equal(totalSeconds(consent.update({ ...initial, consented: true, foreground: false }, 155_000)), 4);
assert.deepEqual(consent.checkpoint(500_000), [], "background time must be excluded");
assert.deepEqual(consent.update({ ...initial, consented: true, screen: "shopping" }, 500_000), [
  { event: "app_opened", properties: { launch_type: "foreground" } },
  { event: "screen_viewed", properties: { screen: "shopping" } },
]);
assert.equal(totalSeconds(consent.checkpoint(530_000)), 30);
assert.deepEqual(consent.update({ ...initial, screen: "shopping" }, 550_000), []);
assert.deepEqual(consent.checkpoint(560_000), [], "revocation must discard pending time");

const cold = new AnalyticsLifecycle();
assert.deepEqual(cold.update({ ...initial, ready: false }, 0), []);
assert.deepEqual(cold.update({ ...initial, consented: true, foreground: false }, 5_000), []);
assert.deepEqual(cold.update({ ...initial, consented: true }, 10_000), [
  { event: "app_opened", properties: { launch_type: "cold" } },
  { event: "screen_viewed", properties: { screen: "authentication" } },
]);
assert.deepEqual(cold.update({ ...initial, consented: true, scope: "new-account", screen: "my_sweet" }, 20_000), [
  { event: "screen_viewed", properties: { screen: "my_sweet" } },
], "signup identity transfer must not invent another app open");
assert.equal(totalSeconds(cold.checkpoint(25_000)), 5, "account transition must not attribute previous time");
assert.deepEqual(cold.update({ ...initial, consented: true, ready: false, scope: "new-account" }, 26_000), []);
assert.deepEqual(cold.update({ ...initial, consented: true, scope: "new-account", screen: "my_sweet" }, 27_000), [
  { event: "screen_viewed", properties: { screen: "my_sweet" } },
], "SDK readiness changes must not invent app opens");
assert.deepEqual(cold.checkpoint(26_000), [], "clock adjustments must not emit negative time");
assert.equal(totalSeconds(cold.checkpoint(29_000)), 3);

assert.equal(analyticsScreenForPath("/(tabs)/shopping?secret=value", true), "shopping");
assert.equal(analyticsScreenForPath("/shopping/private-household-id", true), "other");
assert.equal(analyticsScreenForPath("/settings?email=private", false), "authentication");
assert.equal(analyticsScreenForPath("/leaderboard", true), "ranks");
assert.equal(analyticsScreenForPath("/", true, "household_setup"), "household_setup");
assert.equal(analyticsScreenForPath("/", true, "preferences_onboarding"), "preferences_onboarding");
assert.equal(analyticsScreenForPath("/shopping", false, "household_setup"), "authentication");
assert.equal(analyticsScreenForPath("/", true, "household_error"), "household_error");

const transfer = new AnalyticsLifecycle();
transfer.update({ ...initial, consented: true }, 0);
transfer.update({ ...initial, scope: "new-user", ready: false, consented: true }, 5_000);
assert.deepEqual(transfer.update({ ...initial, scope: "new-user", consented: true, screen: "household_setup" }, 6_000), [
  { event: "screen_viewed", properties: { screen: "household_setup" } },
], "signup with an SDK readiness gap must not duplicate app opens");
assert.equal(totalSeconds(transfer.checkpoint(10_000)), 4);
console.log("analytics lifecycle tests passed");
