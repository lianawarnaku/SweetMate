import assert from "node:assert/strict";
import { backWithFallback } from "./navigation.ts";

for (const fallback of ["/settings", "/(tabs)"] as const) {
  const actions: string[] = [];
  let hasHistory = false;
  const router = { canGoBack: () => hasHistory, back: () => { actions.push("back"); }, replace: (path: unknown) => { actions.push(String(path)); } };
  backWithFallback(router, fallback);
  assert.deepEqual(actions, [fallback], "cold/direct entry navigates to its parent rather than doing nothing");
  hasHistory = true;
  backWithFallback(router, fallback);
  assert.deepEqual(actions, [fallback, "back"], "normal nested entry preserves the actual previous screen");
}
console.log("Navigation history and direct-entry fallback checks passed");
