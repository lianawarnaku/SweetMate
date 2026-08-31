import {
  HOUSEHOLD_SETUP_STEPS,
  HOUSEHOLD_SETUP_VERSION,
  householdSetupStepNumber,
  nextHouseholdSetupStep,
  normalizeHouseholdSetupStep,
  previousHouseholdSetupStep,
} from "./householdSetup.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(
  HOUSEHOLD_SETUP_STEPS.join(",") === "details,home,essentials,items,review",
  "Home type must precede Sweet Essentials and chore-producing space selection",
);
assert(householdSetupStepNumber("essentials") === 3, "Essentials must be step 3 of 5");
assert(nextHouseholdSetupStep("home") === "essentials", "Home must continue to Essentials");
assert(previousHouseholdSetupStep("essentials") === "home", "Back from Essentials must return to Home");
assert(nextHouseholdSetupStep("essentials") === "items", "Essentials must precede space selection");
assert(nextHouseholdSetupStep("review") === "complete", "Review must remain the final setup step");
assert(
  normalizeHouseholdSetupStep("essentials", 2) === "essentials",
  "version 2 stable step identifiers must migrate across the reorder",
);
assert(
  normalizeHouseholdSetupStep("items", HOUSEHOLD_SETUP_VERSION) === "items",
  "versioned explicit steps must restore",
);
assert(
  normalizeHouseholdSetupStep(5, 1) === "essentials",
  "legacy in-progress optional step must migrate to Essentials",
);
assert(
  normalizeHouseholdSetupStep(3, 1) === null,
  "unsafe legacy positions must not be interpreted using the reordered array",
);

const setupScreen = readFileSync(
  resolve(process.cwd(), "components/HouseholdSetupScreen.tsx"),
  "utf8",
);
const planningScreen = readFileSync(resolve(process.cwd(), "app/planning.tsx"), "utf8");
const routeGuard = readFileSync(
  resolve(process.cwd(), "components/HouseholdSetupRouteGuard.tsx"),
  "utf8",
);
const createHouseholdOverloadRepair = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/202608310001_remove_ambiguous_create_household_overload.sql",
  ),
  "utf8",
);

assert(
  setupScreen.includes("detectDeviceTimezone") &&
    setupScreen.includes("TIMEZONE_PRESETS") &&
    setupScreen.includes("{ deferOnboarding: true, timezone }"),
  "household creation must capture and pass along a timezone",
);
assert(
  createHouseholdOverloadRepair.includes(
    "drop function if exists public.create_household(text, text, text, text)",
  ) && createHouseholdOverloadRepair.includes("notify pgrst, 'reload schema'"),
  "the legacy create_household overload must be removed and PostgREST's schema cache refreshed",
);
assert(
  (setupScreen.match(/Keyboard\.dismiss\(\);/g)?.length ?? 0) >= 3,
  "household setup actions must dismiss the keyboard before navigation or submission",
);
assert(
  setupScreen.includes('{ deferOnboarding: true, timezone }') &&
    setupScreen.includes('await setHouseholdSetupStep("home")'),
  "required details must establish one draft household before Home type",
);
assert(
  setupScreen.includes('router.push(`/planning?type=home-checklist&setup=household&housingType=${housingType}`') &&
    setupScreen.includes('onPress={() => void goToStep("items")}'),
  "browse and skip must use explicit setup transitions",
);
assert(
  setupScreen.includes("sweetmate:household-setup-draft:v2:") &&
    setupScreen.includes("restore household setup draft"),
  "the remaining setup form must restore from a versioned user-scoped draft",
);
assert(
  planningScreen.includes("const saved = await saveShortlist();") &&
    planningScreen.includes('await setHouseholdSetupStep("items")') &&
    planningScreen.includes("Continue setup"),
  "setup Essentials must save its shortlist and continue to space selection without Shopping",
);
assert(
  !planningScreen.includes("sendShortlistToShopping") &&
    !planningScreen.includes('addShoppingList("Sweet Essentials")'),
  "setup Essentials must never create automatic Shopping records",
);
assert(
  planningScreen.includes('params.setup === "household"') &&
    routeGuard.includes('setupStep === "essentials" && pathname === "/planning"'),
  "normal Sweet Essentials access must remain distinct from setup access",
);
assert(
  setupScreen.includes("navigationPendingRef.current") &&
    planningScreen.includes("continuingSetupRef.current"),
  "browse and continue actions must suppress duplicate navigation",
);
