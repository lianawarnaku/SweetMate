import { useSyncExternalStore } from "react";
import { AccessibilityInfo, Platform } from "react-native";

type AccessibilityPreferences = {
  reduceMotion: boolean;
  reduceTransparency: boolean;
};

let preferences: AccessibilityPreferences = {
  reduceMotion: false,
  reduceTransparency: false,
};
let initialized = false;
const listeners = new Set<() => void>();

function publish(next: Partial<AccessibilityPreferences>) {
  preferences = { ...preferences, ...next };
  listeners.forEach((listener) => listener());
}

function initialize() {
  if (initialized) return;
  initialized = true;

  Promise.all([
    AccessibilityInfo.isReduceMotionEnabled(),
    Platform.OS === "web"
      ? Promise.resolve(false)
      : AccessibilityInfo.isReduceTransparencyEnabled(),
  ]).then(([reduceMotion, reduceTransparency]) => {
    publish({ reduceMotion, reduceTransparency });
  }).catch(() => {
      // Accessibility events below still keep preferences current if a
      // platform does not support one of the initial queries.
  });

  AccessibilityInfo.addEventListener("reduceMotionChanged", (reduceMotion) => {
    publish({ reduceMotion });
  });
  if (Platform.OS !== "web") {
    AccessibilityInfo.addEventListener(
      "reduceTransparencyChanged",
      (reduceTransparency) => publish({ reduceTransparency }),
    );
  }
}

function subscribe(listener: () => void) {
  initialize();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAccessibilityPreferences() {
  return useSyncExternalStore(subscribe, () => preferences, () => preferences);
}
