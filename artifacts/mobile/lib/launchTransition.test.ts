import assert from "node:assert/strict";
import {
  canRevealLaunch,
  LAUNCH_LAYOUT_FALLBACK_MS,
  launchTiming,
} from "./launchTransition.ts";

assert.equal(
  canRevealLaunch({
    loading: true,
    assemblyComplete: false,
    destinationLaidOut: false,
  }),
  false,
  "launch starts covered while data loads",
);
assert.equal(
  canRevealLaunch({
    loading: false,
    assemblyComplete: false,
    destinationLaidOut: true,
  }),
  false,
  "fast session restoration cannot cut off the bubble-up assembly",
);
assert.equal(
  canRevealLaunch({
    loading: true,
    assemblyComplete: true,
    destinationLaidOut: true,
  }),
  false,
  "slow restoration stays covered after the assembly finishes",
);
assert.equal(
  canRevealLaunch({
    loading: false,
    assemblyComplete: true,
    destinationLaidOut: true,
  }),
  true,
  "ready content and a finished mark can crossfade immediately",
);

const waitingForLayout = {
  loading: false,
  assemblyComplete: true,
  destinationLaidOut: false,
};
assert.equal(
  canRevealLaunch({
    ...waitingForLayout,
    layoutWaitMs: LAUNCH_LAYOUT_FALLBACK_MS - 1,
  }),
  false,
  "a missing layout callback gets a chance to arrive before the fallback",
);
assert.equal(
  canRevealLaunch({
    ...waitingForLayout,
    layoutWaitMs: LAUNCH_LAYOUT_FALLBACK_MS,
  }),
  true,
  "a missing layout callback cannot leave the app permanently hidden",
);
assert.equal(
  canRevealLaunch({ ...waitingForLayout, loading: true, layoutWaitMs: 60_000 }),
  false,
  "the layout fallback must never bypass unfinished authentication or household loading",
);
assert.equal(
  canRevealLaunch({
    ...waitingForLayout,
    assemblyComplete: false,
    layoutWaitMs: 60_000,
  }),
  false,
  "the layout fallback must not bypass unfinished house assembly",
);

assert.equal(
  launchTiming(true).revealMs,
  0,
  "reduced motion must have no animated crossfade",
);
assert(launchTiming(false).revealMs > 0, "normal launch must have a crossfade");
assert.equal(
  launchTiming(true).layoutFallbackMs,
  LAUNCH_LAYOUT_FALLBACK_MS,
  "reduced motion still waits for a ready destination",
);

// Repeat the full range of readiness orderings: a new load after a completed
// launch must block again even if layout/animation readiness is still present.
for (let cycle = 0; cycle < 100; cycle += 1) {
  for (const loading of [true, false]) {
    for (const assemblyComplete of [true, false]) {
      for (const destinationLaidOut of [true, false]) {
        assert.equal(
          canRevealLaunch({ loading, assemblyComplete, destinationLaidOut }),
          !loading && assemblyComplete && destinationLaidOut,
        );
      }
    }
  }
}

console.log("launch transition readiness tests passed");
