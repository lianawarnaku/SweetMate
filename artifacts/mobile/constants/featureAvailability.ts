// Temporarily hide the leaderboard without discarding its implementation or
// anyone's saved points preference. Set this to true when it is ready to return.
export const LEADERBOARD_ENABLED = false;

export function isLeaderboardVisible(pointsEnabled: boolean): boolean {
  return LEADERBOARD_ENABLED && pointsEnabled;
}
