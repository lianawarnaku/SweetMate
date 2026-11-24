export const HOUSEHOLD_SETUP_VERSION = 3;

export const HOUSEHOLD_SETUP_STEPS = [
  "details",
  "home",
  "essentials",
  "items",
  "review",
] as const;

export type HouseholdSetupStep = (typeof HOUSEHOLD_SETUP_STEPS)[number];

export function householdSetupStepNumber(step: HouseholdSetupStep) {
  return HOUSEHOLD_SETUP_STEPS.indexOf(step) + 1;
}

export function nextHouseholdSetupStep(
  step: HouseholdSetupStep,
): HouseholdSetupStep | "complete" {
  const index = HOUSEHOLD_SETUP_STEPS.indexOf(step);
  return HOUSEHOLD_SETUP_STEPS[index + 1] ?? "complete";
}

export function previousHouseholdSetupStep(
  step: HouseholdSetupStep,
): HouseholdSetupStep | null {
  const index = HOUSEHOLD_SETUP_STEPS.indexOf(step);
  return index > 0 ? HOUSEHOLD_SETUP_STEPS[index - 1] : null;
}

export function normalizeHouseholdSetupStep(
  value: unknown,
  version: unknown,
): HouseholdSetupStep | null {
  if (
    version === 2 &&
    HOUSEHOLD_SETUP_STEPS.includes(value as HouseholdSetupStep)
  ) {
    // Version 2 already persisted stable identifiers, so reordering them is safe.
    return value as HouseholdSetupStep;
  }
  if (version !== HOUSEHOLD_SETUP_VERSION) {
    // Version 1 only stored a numeric position. Its former final optional
    // screen now maps to the explicit Essentials decision.
    if (version === 1 && value === 5) return "essentials";
    return null;
  }
  return HOUSEHOLD_SETUP_STEPS.includes(value as HouseholdSetupStep)
    ? (value as HouseholdSetupStep)
    : null;
}

export type HouseholdSetupDestination = "chore-chart" | "app";
export function householdSetupDestinationRoute(destination: HouseholdSetupDestination) {
  return destination === "chore-chart" ? "/planning?type=chore-chart" : "/(tabs)";
}
export function householdSetupDestinationKey(userId: string) {
  return `sweetmate:setup-destination:v1:${userId}`;
}
