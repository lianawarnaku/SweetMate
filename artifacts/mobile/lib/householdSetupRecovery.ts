// A household switch can remount navigation while shared state loads. Keep
// the requested destination through that remount, without changing setup data.
let pendingHouseholdId: string | null = null;
export function requestHouseholdSetupRecovery(householdId: string) {
  pendingHouseholdId = householdId;
}
export function pendingHouseholdSetupRecovery() {
  return pendingHouseholdId;
}
export function consumeHouseholdSetupRecovery(householdId: string) {
  if (pendingHouseholdId !== householdId) return false;
  pendingHouseholdId = null;
  return true;
}
