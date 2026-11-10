// Points displays and the leaderboard are deferred together. Preserve scores,
// scoring behavior, and saved preferences. See docs/points-and-leaderboard.md.
// Set this to true when the feature is ready to return.
export const LEADERBOARD_ENABLED = false;

export function isLeaderboardVisible(pointsEnabled: boolean): boolean {
  return LEADERBOARD_ENABLED && pointsEnabled;
}

/** Point counts, editors, and exports belong to the same deferred feature. */
export function isPointsVisible(pointsEnabled: boolean): boolean {
  return isLeaderboardVisible(pointsEnabled);
}
