import { resolveDisplayPreferenceDefaults } from "./userPreferenceDefaults.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const fresh = resolveDisplayPreferenceDefaults({});
assert(fresh.colorScheme === "mono", "new users must default to Black & White");
assert(fresh.appearanceMode === "dark", "new users must default to dark appearance");
assert(!fresh.pointsEnabled, "new users must default leaderboard to off");
assert(!fresh.roommateActivityEnabled, "new users must default Roommate Activity to off");

const existing = resolveDisplayPreferenceDefaults({
  colorScheme: "pinkWhite",
  appearanceMode: "light",
  pointsEnabled: true,
  roommateActivityEnabled: true,
  plantEnabled: false,
  preferencesVersion: 1,
});
assert(existing.colorScheme === "pinkWhite", "an explicit existing theme must survive migration");
assert(existing.appearanceMode === "light", "an explicit appearance mode must survive migration");
assert(existing.pointsEnabled, "an explicit enabled leaderboard must survive migration");
assert(existing.roommateActivityEnabled, "explicit enabled activity must survive migration");
assert(!existing.plantEnabled, "an unrelated explicit preference must survive migration");

const explicitFalse = resolveDisplayPreferenceDefaults({
  pointsEnabled: false,
  roommateActivityEnabled: false,
});
assert(!explicitFalse.pointsEnabled, "explicit false must not be treated as missing");
assert(!explicitFalse.roommateActivityEnabled, "activity false must not be treated as missing");

const preferencesPanel = readFileSync(
  resolve(process.cwd(), "components/UserPreferencesPanel.tsx"),
  "utf8",
);
const groupScreen = readFileSync(
  resolve(process.cwd(), "app/(tabs)/group.tsx"),
  "utf8",
);
assert(
  preferencesPanel.includes("Show Roommate Activity") &&
    preferencesPanel.includes("value={roommateActivityEnabled}"),
  "Settings and onboarding must display the actual Roommate Activity default",
);
assert(
  /roommateActivityEnabled\s*\?\s*<(?:View|Surface)\b/.test(groupScreen),
  "disabled Roommate Activity must hide the roommate status card",
);
