/** Unknown/loading states must not be presented as incomplete. */
export function householdPlanningNeedsAttention({ setupReady, setupComplete, chartReady, chartComplete }: {
  setupReady: boolean;
  setupComplete: boolean;
  chartReady: boolean;
  chartComplete: boolean;
}): boolean {
  return (setupReady && !setupComplete) || (chartReady && !chartComplete);
}

/** Completion belongs to the latest review, even while an older chart runs. */
export function householdChoreChartComplete(latestChart: { status: string; appliedAt?: string | null } | null): boolean {
  return latestChart?.status === "approved" && Boolean(latestChart.appliedAt);
}


export interface HouseholdChartVerification {
  householdId: string | null;
  observationKey: string;
  ready: boolean;
  complete: boolean;
  error: boolean;
}

/** Cached approved charts cannot override a fresh server check of the review. */
export function resolveHouseholdChartStatus({ householdId, observationKey, latestChart, verification }: {
  householdId: string | null;
  observationKey: string;
  latestChart: { householdId: string; status: string } | null;
  verification: HouseholdChartVerification;
}) {
  const matching = Boolean(householdId && verification.householdId === householdId && verification.observationKey === observationKey);
  if (matching && verification.ready) return { ready: true, complete: verification.complete, error: false };
  if (householdId && latestChart?.householdId === householdId && latestChart.status === "pending") return { ready: true, complete: false, error: false };
  return { ready: false, complete: false, error: matching && verification.error };
}
