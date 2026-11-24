export const PREFERENCE_DOT_COUNT = 13;

export function preferenceDotIndex(value: number): number {
  "worklet";
  return Math.round(Math.max(0, Math.min(100, Number.isFinite(value) ? value : 50)) * 12 / 100);
}

export function preferenceValueAtDot(index: number): number {
  "worklet";
  return Math.round(Math.max(0, Math.min(12, Math.round(index))) * 100 / 12);
}

export function snapPreference(value: number): number {
  "worklet";
  return preferenceValueAtDot(preferenceDotIndex(value));
}

export function stepPreference(value: number, direction: number): number {
  "worklet";
  return preferenceValueAtDot(preferenceDotIndex(value) + direction);
}
