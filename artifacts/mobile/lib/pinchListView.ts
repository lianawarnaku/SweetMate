export type PinchView = "dashboard" | "list";

export function resolvePinchView(scale: number, current: PinchView): PinchView {
  if (scale < 0.88) return "list";
  if (scale > 1.12) return "dashboard";
  return current;
}
