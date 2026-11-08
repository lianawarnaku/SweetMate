export const LAUNCH_LAYOUT_FALLBACK_MS = 1500;

export function launchTiming(reduceMotion: boolean) {
  return {
    revealMs: reduceMotion ? 0 : 280,
    layoutFallbackMs: LAUNCH_LAYOUT_FALLBACK_MS,
  };
}

/**
 * Never reveal an unready app or cut off the house assembly. Some hosts omit a
 * destination layout callback; a bounded fallback avoids an indefinite overlay.
 * Timing/readiness is independent of the user's saved theme.
 */
export function canRevealLaunch({
  loading,
  assemblyComplete,
  destinationLaidOut,
  layoutWaitMs = 0,
}: {
  loading: boolean;
  assemblyComplete: boolean;
  destinationLaidOut: boolean;
  /** Time waiting for destination layout after data became ready. */
  layoutWaitMs?: number;
}): boolean {
  return (
    !loading &&
    assemblyComplete &&
    (destinationLaidOut || layoutWaitMs >= LAUNCH_LAYOUT_FALLBACK_MS)
  );
}
