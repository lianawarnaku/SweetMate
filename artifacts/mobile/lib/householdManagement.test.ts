import { householdChoreChartComplete, householdPlanningNeedsAttention, resolveHouseholdChartStatus } from "./householdPlanningStatus.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const appRoot = resolve(process.cwd(), "app");
const settings = readFileSync(resolve(appRoot, "settings.tsx"), "utf8");
const setupRoute = readFileSync(resolve(appRoot, "sweet-setup.tsx"), "utf8");
const setup = readFileSync(resolve(process.cwd(), "components/HouseholdSetupScreen.tsx"), "utf8");
const context = readFileSync(resolve(process.cwd(), "context/AppContext.tsx"), "utf8");
const authGate = readFileSync(resolve(process.cwd(), "components/AuthGate.tsx"), "utf8");

assert(settings.includes("memberships.map((membership) =>"), "Manage Households must list every membership");
assert(settings.includes("membership.sweetId === activeSweetId"), "active household must use a stable ID");
assert(settings.includes("membership.memberCount"), "membership rows must display member counts");
assert(settings.includes('membership.role === "owner" ? "Host" : "Member"'), "rows must display per-household roles");
assert(settings.includes("Create Household") && settings.includes("Join Household"), "create and join must be explicit actions");
assert(settings.includes("Loading your households…"), "loading must not render as an empty membership list");
assert(!settings.includes("Create or join a household"), "management must not reuse the ambiguous onboarding action");
assert(settings.includes("/sweet-setup?mode=create&additional=1") && settings.includes("/sweet-setup?mode=join&additional=1"), "actions must preserve management intent");
assert(setupRoute.includes("useLocalSearchParams") && setupRoute.includes("additionalHousehold={additionalHousehold}"), "setup route must preserve management intent");
assert(setup.includes("if (!householdId || (additionalHousehold && !createdAdditionalHouseholdId))"), "an existing member must create one household per setup");
assert(setup.includes("await completeHouseholdSetup(completedProfile);") && !setup.includes("if (!additionalHousehold) await completeHouseholdSetup()"), "every created household must finish with invite and preferences onboarding");
assert(!setup.includes("if (!additionalHousehold) await setHouseholdSetupStep(nextStep)") && !setup.includes("additional-v1"), "additional households must share resumable setup progress and drafts when returning from Essentials");
assert(context.includes('.eq("user_id", userId)') && context.includes('.eq("status", "active")'), "load all active memberships for the authenticated user");
assert(context.includes("nextMemberships.find((membership) => membership.sweetId === storedActiveSweetId)"), "restore a valid active household ID");
assert(context.includes("setCurrentMemberRole(membership.role)"), "switching must resolve the selected role");
assert(context.includes("setChores([])") && context.includes("setExpenses([])") && context.includes("setShoppingLists([])"), "switching must clear household data");
assert(context.includes("householdError: string | null") && authGate.includes("HouseholdLoadError"), "membership errors must be recoverable instead of opening creation");

console.log("household management tests passed");

for (const setupComplete of [false, true]) {
  for (const chartComplete of [false, true]) {
    assert(householdPlanningNeedsAttention({ setupReady: true, setupComplete, chartReady: true, chartComplete }) === (!setupComplete || !chartComplete), "either incomplete planning step must prioritize Household Preferences");
  }
}
assert(!householdPlanningNeedsAttention({ setupReady: false, setupComplete: false, chartReady: false, chartComplete: false }), "loading states must not be treated as incomplete");
assert(householdPlanningNeedsAttention({ setupReady: true, setupComplete: false, chartReady: false, chartComplete: false }), "known incomplete setup must be prioritized while chart status loads");
assert(!householdPlanningNeedsAttention({ setupReady: true, setupComplete: true, chartReady: true, chartComplete: true }), "completed setup and chart do not need prioritizing");


const oldAppliedChart = { status: "approved", appliedAt: "2026-11-23T18:00:00Z" };
assert(householdChoreChartComplete(oldAppliedChart), "an approved, applied latest chart is complete");
const restartedChart = { status: "pending", appliedAt: null };
assert(!householdChoreChartComplete(restartedChart), "a restarted review must be incomplete even when an older chart is applied");
assert(householdPlanningNeedsAttention({ setupReady: true, setupComplete: true, chartReady: true, chartComplete: householdChoreChartComplete(restartedChart) }), "restart must prioritize Household Preferences while the chart awaits fresh approval");
assert(!householdChoreChartComplete({ ...restartedChart }), "one member's approval leaves the latest chart pending and incomplete");
assert(!householdChoreChartComplete({ status: "approved", appliedAt: null }), "the status must wait for the newly approved chart to finish activating");
assert(householdChoreChartComplete({ status: "approved", appliedAt: "2026-11-24T18:00:00Z" }), "the status returns to complete once the new review is approved and applied");
assert(!householdChoreChartComplete({ status: "pending", appliedAt: oldAppliedChart.appliedAt }), "an applied timestamp cannot make a pending review complete");
assert(!householdChoreChartComplete({ status: "cancelled", appliedAt: oldAppliedChart.appliedAt }), "cancelled reviews cannot mark setup complete");
assert(!householdChoreChartComplete(null), "a household without a chart is incomplete");
console.log("Household chart completion review tests passed");


const cachedApproved = { householdId: "avery-home", status: "approved" };
const confirmedPending = { householdId: "avery-home", observationKey: "old-cached-chart", ready: true, complete: false, error: false };
const averyStatus = resolveHouseholdChartStatus({ householdId: "avery-home", observationKey: "old-cached-chart", latestChart: cachedApproved, verification: confirmedPending });
assert(averyStatus.ready && !averyStatus.complete, "Avery must see incomplete when the server's latest review is pending, even if her context caches an old applied chart");
const staleSuccess = { ...confirmedPending, complete: true, observationKey: "previous-version" };
const whileChecking = resolveHouseholdChartStatus({ householdId: "avery-home", observationKey: "new-version", latestChart: cachedApproved, verification: staleSuccess });
assert(!whileChecking.complete && !whileChecking.ready, "an unverified cached approved chart must not retain a completed checkmark");
const newPendingStatus = resolveHouseholdChartStatus({ householdId: "avery-home", observationKey: "new-version", latestChart: { ...cachedApproved, status: "pending" }, verification: staleSuccess });
assert(newPendingStatus.ready && !newPendingStatus.complete, "a newly observed pending review immediately overrides an old successful verification");
const confirmedComplete = resolveHouseholdChartStatus({ householdId: "avery-home", observationKey: "current", latestChart: { ...cachedApproved, status: "pending" }, verification: { ...confirmedPending, observationKey: "current", complete: true } });
assert(confirmedComplete.complete, "a fresh all-approved server result must update a lagging local pending chart");
const failedCheck = resolveHouseholdChartStatus({ householdId: "avery-home", observationKey: "current", latestChart: cachedApproved, verification: { ...confirmedPending, observationKey: "current", ready: false, complete: false, error: true } });
assert(!failedCheck.complete && !failedCheck.ready && failedCheck.error, "a failed fresh check cannot fall back to an old completed chart");
const otherHouseholdStatus = resolveHouseholdChartStatus({ householdId: "other-home", observationKey: "current", latestChart: cachedApproved, verification: { ...confirmedPending, observationKey: "current", complete: true } });
assert(!otherHouseholdStatus.complete && !otherHouseholdStatus.ready, "completion checks cannot cross households");
console.log("Avery pending approval completion regressions passed");
