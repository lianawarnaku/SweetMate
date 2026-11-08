import { usePathname } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";

import { useAnalyticsPreferences } from "@/components/AnalyticsConsentManager";
import { useAppContextSelector } from "@/context/AppContext";
import { flushAnalytics, track } from "@/lib/analytics";
import { AnalyticsLifecycle, analyticsScreenForPath, type LifecycleEvent } from "@/lib/analyticsLifecycle";

function isForeground(nativeState: AppStateStatus) {
  if (Platform.OS === "web" && typeof document !== "undefined") {
    return document.visibilityState !== "hidden";
  }
  return nativeState === "active";
}

function now() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now() : Date.now();
}

function emit(events: LifecycleEvent[]) {
  for (const event of events) {
    if (event.event === "app_opened") track.appOpened(event.properties);
    else if (event.event === "screen_viewed") track.screenViewed(event.properties);
    else track.appActiveTime(event.properties);
  }
}

export function AnalyticsLifecycleTracker({
  userId,
  enabled = true,
}: {
  userId: string | null;
  enabled?: boolean;
}) {
  const pathname = usePathname();
  const { loaded, ready, preferences } = useAnalyticsPreferences(userId);
  const gate = useAppContextSelector((context) =>
    context.householdError ? "household_error" as const
      : !context.householdId ? "household_setup" as const
      : context.preferencesOnboardingPending && !context.householdSetupStep
        ? "preferences_onboarding" as const : null,
  );
  const screen = analyticsScreenForPath(pathname, Boolean(userId), gate);
  const machine = useRef(new AnalyticsLifecycle());
  const nativeState = useRef(AppState.currentState);
  const current = useRef({ userId, screen, ready: false, consented: false });
  current.current = {
    userId, screen,
    ready: enabled && loaded && ready,
    consented: preferences.productAnalyticsEnabled,
  };

  useEffect(() => {
    const update = () => {
      const state = current.current;
      const foreground = isForeground(nativeState.current);
      emit(machine.current.update({
        scope: state.userId ?? "preauth",
        ready: state.ready,
        consented: state.consented,
        foreground,
        screen: state.screen,
      }, now()));
      // Ask the SDK to deliver the final foreground delta before suspension.
      if (!foreground) void flushAnalytics();
    };
    update();
    const subscription = AppState.addEventListener("change", (state) => {
      nativeState.current = state;
      update();
    });
    if (Platform.OS === "web" && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", update);
    }
    // Flush small deltas regularly: an OS kill may not deliver a final event.
    const timer = setInterval(() => {
      update();
      emit(machine.current.checkpoint(now()));
    }, 30_000);
    return () => {
      subscription.remove();
      clearInterval(timer);
      if (Platform.OS === "web" && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", update);
      }
    };
  }, []);

  useEffect(() => {
    const state = current.current;
    emit(machine.current.update({
      scope: state.userId ?? "preauth",
      ready: state.ready,
      consented: state.consented,
      foreground: isForeground(nativeState.current),
      screen: state.screen,
    }, now()));
  }, [userId, screen, enabled, loaded, ready, preferences.productAnalyticsEnabled]);

  return null;
}
