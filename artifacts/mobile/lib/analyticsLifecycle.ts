// Only these names may leave the device. Never send raw route paths or params.
export type AnalyticsScreen =
  | "authentication" | "my_sweet" | "group" | "expenses" | "shopping"
  | "borrow" | "ranks" | "settings" | "planning" | "task_difficulty"
  | "alerts" | "household_setup" | "preferences_onboarding" | "household_error"
  | "auth_callback" | "other";

const SCREENS: Readonly<Record<string, AnalyticsScreen>> = {
  "/": "my_sweet", "/group": "group", "/expenses": "expenses",
  "/shopping": "shopping", "/borrow": "borrow", "/leaderboard": "ranks",
  "/settings": "settings", "/planning": "planning",
  "/task-difficulty": "task_difficulty", "/alerts": "alerts",
  "/sweet-setup": "household_setup", "/auth/callback": "auth_callback",
};

export function analyticsScreenForPath(
  pathname: string,
  signedIn: boolean,
  gate?: "household_setup" | "preferences_onboarding" | "household_error" | null,
): AnalyticsScreen {
  if (!signedIn) return "authentication";
  if (gate) return gate;
  // Expo Router normally omits group segments; accepting them here also keeps
  // static/web navigation consistent without allowing arbitrary paths through.
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/\(tabs\)(?=\/|$)/, "") || "/";
  return SCREENS[path] ?? "other";
}

export type LifecycleEvent =
  | { event: "app_opened"; properties: { launch_type: "cold" | "foreground" | "consent" } }
  | { event: "screen_viewed"; properties: { screen: AnalyticsScreen } }
  | { event: "app_active_time"; properties: { duration_seconds: number } };

type LifecycleState = {
  scope: string;
  ready: boolean;
  consented: boolean;
  foreground: boolean;
  screen: AnalyticsScreen;
};

// A single foreground stopwatch survives route renders. Only consented time is
// counted; interrupted readiness/account changes discard an unfinished segment
// so it can never be delivered under another account's identity.
export class AnalyticsLifecycle {
  private scope: string | null = null;
  private resolved = false;
  private consented = false;
  private foreground = false;
  private ready = false;
  private segmentStartedAt: number | null = null;
  private lastScreen: AnalyticsScreen | null = null;
  private pendingOpen: "cold" | "consent" | null = null;

  update(next: LifecycleState, now: number): LifecycleEvent[] {
    const events: LifecycleEvent[] = [];
    const scopeChanged = this.scope !== null && this.scope !== next.scope;
    const firstResolved = !this.resolved && next.ready;
    const consentStarted = !this.consented && next.consented;
    const foregroundStarted = !this.foreground && next.foreground;
    const resumedAfterReadiness = !this.ready && this.resolved && this.consented;
    if (scopeChanged) this.pendingOpen = null;
    if (next.ready && next.consented && (firstResolved || consentStarted)) {
      this.pendingOpen = firstResolved ? "cold" : "consent";
    }
    if (scopeChanged || !next.ready || !next.consented) {
      this.segmentStartedAt = null;
      this.lastScreen = null;
      if (next.ready && !next.consented) this.pendingOpen = null;
    } else if (!next.foreground && this.segmentStartedAt !== null) {
      events.push(...this.checkpoint(now));
      this.segmentStartedAt = null;
      this.lastScreen = null;
    }
    if (next.ready && next.consented && next.foreground) {
      if (this.segmentStartedAt === null) {
        this.segmentStartedAt = now;
        // Changing account during an already-open app is not another app open.
        if (!scopeChanged && (!resumedAfterReadiness || this.pendingOpen)) {
          const launchType = this.pendingOpen ?? (foregroundStarted ? "foreground" : null);
          if (launchType) events.push({ event: "app_opened", properties: { launch_type: launchType } });
        }
        this.pendingOpen = null;
      }
      if (this.lastScreen !== next.screen) {
        events.push({ event: "screen_viewed", properties: { screen: next.screen } });
        this.lastScreen = next.screen;
      }
    }
    this.scope = next.scope;
    this.ready = next.ready;
    if (next.ready) {
      this.resolved = true;
      this.consented = next.consented;
    }
    this.foreground = next.foreground;
    return events;
  }

  checkpoint(now: number): LifecycleEvent[] {
    if (!this.ready || !this.consented || !this.foreground || this.segmentStartedAt === null) return [];
    if (now < this.segmentStartedAt) {
      this.segmentStartedAt = now;
      return [];
    }
    const duration = Math.floor((now - this.segmentStartedAt) / 1000);
    if (duration === 0) return [];
    this.segmentStartedAt += duration * 1000;
    return [{ event: "app_active_time", properties: { duration_seconds: duration } }];
  }
}
