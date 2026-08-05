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
assert(setup.includes("if (!householdId || additionalHousehold)"), "an existing member must be able to create another household");
assert(setup.includes("if (!additionalHousehold) await completeHouseholdSetup()"), "adding a household must not rerun onboarding");
assert(context.includes('.eq("user_id", userId)') && context.includes('.eq("status", "active")'), "load all active memberships for the authenticated user");
assert(context.includes("nextMemberships.find((membership) => membership.sweetId === storedActiveSweetId)"), "restore a valid active household ID");
assert(context.includes("setCurrentMemberRole(membership.role)"), "switching must resolve the selected role");
assert(context.includes("setChores([])") && context.includes("setExpenses([])") && context.includes("setShoppingLists([])"), "switching must clear household data");
assert(context.includes("householdError: string | null") && authGate.includes("HouseholdLoadError"), "membership errors must be recoverable instead of opening creation");

console.log("household management tests passed");
