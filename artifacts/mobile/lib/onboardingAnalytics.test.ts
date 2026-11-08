import assert from "node:assert/strict";
import { createOnboardingAnalyticsTracker } from "./onboardingAnalytics.ts";

const events: { event: string; properties: Record<string, unknown> }[] = [];
const record = (event: string) => (properties: Record<string, unknown>) => events.push({ event, properties });
const tracker = createOnboardingAnalyticsTracker({
  started: record("started"), viewed: record("viewed"),
  stepCompleted: record("step_completed"), completed: record("completed"),
  cancelled: record("cancelled"),
});
const count = (event: string) => events.filter((entry) => entry.event === event).length;

tracker.view("local-user", "create", "additional_household", "details", false);
tracker.view("local-user", "create", "additional_household", "details", false);
assert.equal(count("started"), 1);
assert.equal(count("viewed"), 1, "rerenders/remounts must not duplicate a visible step");
tracker.completeStep("local-user", "create", "details");
tracker.completeStep("local-user", "create", "details");
assert.equal(count("step_completed"), 1, "repeated presses must not complete a step twice");
// AuthGate and Essentials replace the route without carrying the additional flag.
tracker.view("local-user", "create", "first_household", "home", true);
assert.equal(events.at(-1)?.properties.context, "additional_household");
assert.equal(count("started"), 1, "route replacement must retain the original flow");
tracker.view("local-user", "create", "first_household", "essentials", true);
tracker.completeStep("local-user", "create", "essentials", "skipped");
assert.equal(events.at(-1)?.properties.outcome, "skipped");
// React may mount the preferences screen before the setup promise resumes.
tracker.view("local-user", "preferences", "first_household", "preferences", false);
tracker.completeStep("local-user", "create", "review");
tracker.complete("local-user", "create");
assert.equal(events.at(-1)?.properties.flow, "create", "async completions must retain their own flow");
assert.equal(events.at(-1)?.properties.context, "additional_household");
tracker.completeStep("local-user", "preferences", "preferences");
tracker.complete("local-user", "preferences");
tracker.complete("local-user", "preferences");
assert.equal(count("completed"), 2, "each distinct flow must complete once");

tracker.view("other-user", "join", "first_household", "join", false);
tracker.complete("local-user", "join");
assert.equal(count("completed"), 2, "old-account callbacks must never complete another account's flow");
tracker.cancel("other-user", "join", "join");
tracker.view("other-user", "join", "first_household", "join", false);
assert.equal(count("started"), 4, "a cancelled attempt followed by a retry is a new flow");
for (const { properties } of events) {
  assert(!Object.values(properties).includes("local-user"));
  assert(!Object.values(properties).includes("other-user"), "local account IDs must not enter event properties");
}
console.log("onboarding analytics transition tests passed");
