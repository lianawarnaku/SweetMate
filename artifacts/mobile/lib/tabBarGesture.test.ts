import {
  clampTabIndicatorX,
  resolveDraggedTabIndex,
} from "./tabBarGesture.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(clampTabIndicatorX(-24, 70, 5) === 0, "dragging before the first tab must clamp");
assert(clampTabIndicatorX(360, 70, 5) === 280, "dragging after the last tab must clamp");
assert(clampTabIndicatorX(112, 70, 5) === 112, "in-range dragging must remain continuous");

assert(resolveDraggedTabIndex(34, 70, 5) === 0, "a drag before the midpoint stays on its tab");
assert(resolveDraggedTabIndex(36, 70, 5) === 1, "crossing the midpoint previews the next tab");
assert(resolveDraggedTabIndex(279, 70, 5) === 4, "the final tab must be reachable");
assert(resolveDraggedTabIndex(500, 70, 5) === 4, "resolved indices must clamp at the end");

console.log("tab bar gesture tests passed");
