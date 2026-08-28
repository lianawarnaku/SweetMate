import { resolvePinchView } from "./pinchListView.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(resolvePinchView(0.7, "dashboard") === "list", "pinching inward should open list view");
assert(resolvePinchView(1.3, "list") === "dashboard", "pinching outward should restore dashboard view");
assert(resolvePinchView(1.02, "list") === "list", "small scale changes should not switch views");

console.log("pinch list view tests passed");
