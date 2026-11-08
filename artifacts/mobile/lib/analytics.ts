import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import { Platform } from "react-native";
import PostHog from "posthog-react-native";
import * as Sentry from "@sentry/react-native";

import type { WorkflowFailureOperation } from "@/lib/workflowAnalytics";
import type { AnalyticsScreen } from "@/lib/analyticsLifecycle";
import { createExternalStoreSnapshotCache } from "@/lib/externalStoreSnapshot";

export const PRIVACY_NOTICE_VERSION = "2026-11-08";

export type AnalyticsPreferences = {
  productAnalyticsEnabled: boolean;
  crashReportingEnabled: boolean;
  noticeVersion: string | null;
};

export type AnalyticsCountBucket = "0" | "1_5" | "6_10" | "11_plus";
export function analyticsCountBucket(count: number): AnalyticsCountBucket {
  return count <= 0 ? "0" : count <= 5 ? "1_5" : count <= 10 ? "6_10" : "11_plus";
}
type OnboardingProperties = {
  flow: "create" | "join" | "preferences";
  context: "first_household" | "additional_household";
};
type OnboardingStepProperties = OnboardingProperties & {
  step: "details" | "home" | "essentials" | "items" | "review" | "join" | "preferences";
};
type EventProperties = {
  analytics_consent_granted: { source: "before_auth" | "privacy_notice" | "settings" };
  app_opened: { launch_type: "cold" | "foreground" | "consent" };
  screen_viewed: { screen: AnalyticsScreen };
  app_active_time: { duration_seconds: number };
  auth_started: { method: "email" | "google" | "apple"; mode: "signin" | "signup" };
  auth_succeeded: { method: "email" | "google" | "apple"; mode: "signin" | "signup" };
  onboarding_started: OnboardingProperties & { resumed: boolean };
  onboarding_step_viewed: OnboardingStepProperties;
  onboarding_step_completed: OnboardingStepProperties & { outcome?: "continued" | "skipped" | "browsed" };
  onboarding_completed: OnboardingProperties;
  onboarding_cancelled: OnboardingStepProperties;
  chore_undone: { recurring: boolean };
  shopping_item_completed: Record<string, never>;
  shopping_item_reopened: Record<string, never>;
  borrowing_return_requested: Record<string, never>;
  borrowing_return_undone: Record<string, never>;
  expense_repayment_recorded: { settles_expense: boolean };
  chore_batch_created: { source: "bulk"; chore_count_bucket: AnalyticsCountBucket };
  chore_plan_applied: { source: "generated"; chore_count_bucket: AnalyticsCountBucket };
  shortlist_sent_to_shopping: { item_count_bucket: AnalyticsCountBucket; list_count_bucket: AnalyticsCountBucket };
  account_created: { method: "email" };
  first_sweetmate_invited: { source: "invite_code" | "share" };
  first_chore_created: { source: "individual" | "bulk" | "chart"; recurring?: boolean };
  first_chore_completed: { recurring: boolean };
  sweet_created: { source: "setup" | "settings" };
  sweet_joined: { source: "invite" | "setup" };
  sweet_switched: { destination: "existing" | "new" };
  chore_created: { recurring: boolean };
  chore_completed: { recurring: boolean };
  chore_deleted: { recurring: boolean };
  chore_reassigned: { assignment_mode: "specific_person" | "round_robin" | "unassigned" };
  chore_plan_created: { source: "manual" | "generated"; chore_count_bucket: AnalyticsCountBucket };
  invite_copied: Record<string, never>;
  invite_shared: Record<string, never>;
  shopping_list_created: Record<string, never>;
  shopping_item_added: Record<string, never>;
  expense_created: { recurring: boolean };
  shopping_expense_created: Record<string, never>;
  iou_created: { split_mode: "equal" | "custom" };
  iou_settled: { source: "manual" | "repayment" };
  borrowing_item_added: Record<string, never>;
  borrowing_item_returned: Record<string, never>;
  nudge_sent: { channel: "in_app" | "push" };
  calendar_exported: { item_type: "chore" | "shopping" | "expense" };
  quick_guide_opened: { source: "settings" | "onboarding" };
  quick_guide_completed: { source: "settings" | "onboarding" };
  workflow_failed: {
    feature: "auth" | "household" | "chore" | "shopping" | "expense" | "calendar" | "storage" | "sync";
    operation: WorkflowFailureOperation;
    error_category: "network" | "permission" | "validation" | "server" | "storage" | "unknown";
  };
  performance_timing: {
    operation: "cold_launch" | "warm_launch" | "storage_hydration" | "tab_ready" | "sweet_switch" | "mutation_visible" | "server_sync";
    duration_bucket: "under_250ms" | "250ms_1s" | "1s_3s" | "over_3s";
    visit: "first" | "repeat" | "not_applicable";
  };
  shortlist_opened: { source: "sweet_essentials" };
  shortlist_saved: {
    item_count_bucket: AnalyticsCountBucket;
    category_count: number;
    source: "sweet_essentials";
  };
};

type EventName = keyof EventProperties;
type SafeValue = string | number | boolean | null;
const PREFERENCES_PREFIX = "sweetmate:telemetry-preferences:v1";
const ANALYTICS_ID_PREFIX = "sweetmate:analytics-id:v1";
const environment =
  process.env.EXPO_PUBLIC_APP_ENV ?? (__DEV__ ? "development" : "production");
const PREAUTH_SCOPE = "signed-out";
const FIRST_EVENTS_PREFIX = "sweetmate:analytics-first:v1";
const listeners = new Set<() => void>();
const preferencesByUser = new Map<string, AnalyticsPreferences>();
let activeUserId: string | null = null;
let posthog: PostHog | null = null;
let vendorScope: string | null = null;
let sentryInitialized = false;
let diagnosticId: string | null = null;
let revision = 0;
let appliedRevision = -1;
let preauthTarget: string | null = null;
let authAttempt = 0;
let completedAuthAttempt = -1;
let transition: Promise<void> = Promise.resolve();
const firstEvents = new Map<string, Set<string>>();
const pendingConsentGrants = new Map<string, EventProperties["analytics_consent_granted"]>();

function scopeKey(userId: string | null) { return userId ?? PREAUTH_SCOPE; }
function enqueue(work: () => Promise<void>) {
  const next = transition.catch(() => {}).then(work);
  transition = next.catch(() => {});
  return next;
}

const DEFAULT_PREFERENCES: AnalyticsPreferences = {
  productAnalyticsEnabled: false,
  crashReportingEnabled: false,
  noticeVersion: null,
};
const snapshotCache = createExternalStoreSnapshotCache(DEFAULT_PREFERENCES);

const deniedKeys =
  /(^|_)(email|name|display_name|invite_code|sweet_name|household_name|title|description|note|item|token|password|address|photo|avatar|message|query|url)($|_)/i;

function preferenceKey(userId: string) {
  return `${PREFERENCES_PREFIX}:${userId}`;
}

function analyticsIdKey(userId: string) {
  return `${ANALYTICS_ID_PREFIX}:${userId}`;
}

function notify() {
  listeners.forEach((listener) => listener());
}

function safeProperties(input: Record<string, SafeValue>) {
  const output: Record<string, SafeValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (deniedKeys.test(key) && !["item_count_bucket", "item_type"].includes(key)) {
      if (__DEV__) console.warn(`[analytics] blocked sensitive property key: ${key}`);
      continue;
    }
    output[key] = value;
  }
  return output;
}

function baseProperties(): Record<string, SafeValue> {
  return {
    platform: Platform.OS,
    app_version: Application.nativeApplicationVersion ?? "unknown",
    build_number: Application.nativeBuildVersion ?? "unknown",
    environment,
    // Static/Expo Go builds do not expose an EAS Update ID. Keep the schema
    // stable without substituting the unrelated EAS project identifier.
    update_id: null,
    analytics_schema_version: 2,
  };
}

async function opaqueId(userId: string) {
  const key = analyticsIdKey(userId);
  const existing = await AsyncStorage.getItem(key);
  if (existing) return existing;
  const id = `sm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
  await AsyncStorage.setItem(key, id);
  return id;
}

function currentPreferences() {
  return activeUserId
    ? preferencesByUser.get(activeUserId) ?? DEFAULT_PREFERENCES
    : DEFAULT_PREFERENCES;
}

function hasProductConsent(preferences = currentPreferences()) {
  return preferences.productAnalyticsEnabled && preferences.noticeVersion === PRIVACY_NOTICE_VERSION;
}
function hasCrashConsent() {
  const preferences = currentPreferences();
  return preferences.crashReportingEnabled && preferences.noticeVersion === PRIVACY_NOTICE_VERSION;
}

async function applyPreferences(userId: string, expectedRevision: number) {
  if (expectedRevision !== revision || activeUserId !== userId) return;
  const preferences = preferencesByUser.get(userId) ?? DEFAULT_PREFERENCES;
  const id = await opaqueId(userId);
  if (expectedRevision !== revision) return;
  // A different account must never inherit the previous vendor identity.
  if (posthog && vendorScope !== userId) {
    await posthog.reset();
    await posthog.optOut();
    posthog = null;
    vendorScope = null;
  }
  if (expectedRevision !== revision) return;
  const posthogKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
  if (hasProductConsent(preferences) && posthogKey) {
    posthog ??= new PostHog(posthogKey, {
      host: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
      captureAppLifecycleEvents: false,
      enableSessionReplay: false,
      defaultOptIn: false,
      preloadFeatureFlags: false,
    });
    await posthog.optIn();
    if (expectedRevision !== revision) return;
    posthog.identify(id, baseProperties());
    vendorScope = userId;
  } else if (posthog) {
    await posthog.reset();
    await posthog.optOut();
    posthog = null;
    vendorScope = null;
  }
  if (expectedRevision !== revision) return;
  diagnosticId = hasCrashConsent() ? id : null;
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (hasCrashConsent() && dsn && !sentryInitialized) {
    Sentry.init({
      dsn,
      environment,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      enableAutoSessionTracking: false,
      beforeBreadcrumb: (breadcrumb) =>
        ["console", "http", "xhr"].includes(breadcrumb.category ?? "") ? null : breadcrumb,
      beforeSend: (event) => {
        if (!hasCrashConsent() || !diagnosticId || appliedRevision !== revision) return null;
        if (event.user?.id && event.user.id !== diagnosticId) return null;
        delete event.request;
        delete event.message;
        for (const value of event.exception?.values ?? []) value.value = "Application error";
        event.user = { id: diagnosticId };
        event.extra = safeProperties(
          Object.fromEntries(Object.entries(event.extra ?? {}).filter(([, value]) =>
            ["string", "number", "boolean"].includes(typeof value),
          )) as Record<string, SafeValue>,
        );
        return event;
      },
    });
    sentryInitialized = true;
  }
  Sentry.setUser(hasCrashConsent() && dsn ? { id } : null);
  if (sentryInitialized && hasCrashConsent()) Sentry.setTags(baseProperties() as Record<string, string>);
  appliedRevision = expectedRevision;
}

export function loadAnalyticsPreferences(userId: string | null) {
  const scope = scopeKey(userId);
  const previousScope = activeUserId;
  if (userId && previousScope === PREAUTH_SCOPE) preauthTarget = userId;
  if (!userId && previousScope && previousScope !== PREAUTH_SCOPE) {
    preauthTarget = null;
    ++authAttempt;
  }
  activeUserId = scope;
  const expectedRevision = ++revision;
  snapshotCache.publish(scope, false, preferencesByUser.get(scope) ?? DEFAULT_PREFERENCES);
  notify();
  return enqueue(async () => {
    if (expectedRevision !== revision) return;
    // Sign-out gets a fresh pre-auth choice, rather than passing the last person's
    // consent to the next person on a shared device.
    if (!userId && previousScope && previousScope !== PREAUTH_SCOPE) {
      await AsyncStorage.multiRemove([preferenceKey(PREAUTH_SCOPE), analyticsIdKey(PREAUTH_SCOPE)]);
      preferencesByUser.delete(PREAUTH_SCOPE);
    }
    const raw = await AsyncStorage.getItem(preferenceKey(scope));
    if (expectedRevision !== revision) return;
    let preferences = DEFAULT_PREFERENCES;
    if (raw) {
      try { preferences = { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) }; } catch {}
    }
    if (userId && preauthTarget === userId) {
      // The fresh pre-auth choice takes precedence on this device, including a
      // fresh opt-out. Restoring a session without that choice uses saved prefs.
      const pending = await AsyncStorage.getItem(preferenceKey(PREAUTH_SCOPE));
      if (expectedRevision !== revision) return;
      if (pending) {
        let parsed: AnalyticsPreferences | null = null;
        try { parsed = { ...DEFAULT_PREFERENCES, ...JSON.parse(pending) }; } catch {}
        if (parsed?.noticeVersion === PRIVACY_NOTICE_VERSION) {
          preferences = parsed;
          await AsyncStorage.setItem(preferenceKey(scope), JSON.stringify(preferences));
          if (expectedRevision !== revision) return;
          const existingId = await AsyncStorage.getItem(analyticsIdKey(scope));
          if (expectedRevision !== revision) return;
          if (parsed.productAnalyticsEnabled && !existingId) {
            const anonymousId = await opaqueId(PREAUTH_SCOPE);
            if (expectedRevision !== revision) return;
            await AsyncStorage.setItem(analyticsIdKey(scope), anonymousId);
          }
        }
      }
      if (expectedRevision !== revision) return;
      await AsyncStorage.multiRemove([preferenceKey(PREAUTH_SCOPE), analyticsIdKey(PREAUTH_SCOPE)]);
      preauthTarget = null;
      preferencesByUser.delete(PREAUTH_SCOPE);
      snapshotCache.remove(PREAUTH_SCOPE);
    }
    if (expectedRevision !== revision) return;
    preferencesByUser.set(scope, preferences);
    try {
      const first = await AsyncStorage.getItem(`${FIRST_EVENTS_PREFIX}:${scope}`);
      firstEvents.set(scope, new Set(first ? JSON.parse(first) : []));
    } catch { firstEvents.set(scope, new Set()); }
    if (expectedRevision !== revision) return;
    await applyPreferences(scope, expectedRevision);
    if (expectedRevision !== revision) return;
    snapshotCache.publish(scope, true, preferences);
    notify();
  });
}

export function saveAnalyticsPreferences(
  userId: string | null,
  update: Partial<AnalyticsPreferences>,
  source: EventProperties["analytics_consent_granted"]["source"] = userId ? "settings" : "before_auth",
) {
  const scope = scopeKey(userId);
  let previousSaved = preferencesByUser.get(scope) ?? DEFAULT_PREFERENCES;
  activeUserId = scope;
  const expectedRevision = ++revision;
  snapshotCache.publish(scope, false, preferencesByUser.get(scope) ?? DEFAULT_PREFERENCES);
  notify();
  return enqueue(async () => {
    // Merge inside the queue so rapid independent toggles cannot erase a choice.
    const previous = preferencesByUser.get(scope) ?? DEFAULT_PREFERENCES;
    previousSaved = previous;
    const next = { ...previous, ...update };
    if (hasProductConsent(next) && !hasProductConsent(previous)) pendingConsentGrants.set(scope, { source });
    else if (!hasProductConsent(next)) pendingConsentGrants.delete(scope);
    await AsyncStorage.setItem(preferenceKey(scope), JSON.stringify(next));
    preferencesByUser.set(scope, next);
    if (expectedRevision !== revision) return;
    await applyPreferences(scope, expectedRevision);
    if (expectedRevision !== revision) return;
    const grant = pendingConsentGrants.get(scope);
    if (grant && capture("analytics_consent_granted", grant)) pendingConsentGrants.delete(scope);
    snapshotCache.publish(scope, true, next);
    notify();
  }).catch((error) => {
    // A failed save/SDK setup must not leave the notice hidden with auth locked.
    if (expectedRevision === revision) {
      preferencesByUser.set(scope, previousSaved);
      snapshotCache.publish(scope, true, previousSaved);
      notify();
    }
    throw error;
  });
}

export function resetAnalyticsIdentity() {
  activeUserId = null;
  diagnosticId = null;
  preauthTarget = null;
  ++authAttempt;
  ++revision;
  return enqueue(async () => {
    if (posthog) { await posthog.reset(); await posthog.optOut(); }
    posthog = null;
    vendorScope = null;
    Sentry.setUser(null);
  });
}

export async function deleteLocalAnalyticsIdentity(userId: string) {
  await resetAnalyticsIdentity();
  await AsyncStorage.multiRemove([preferenceKey(userId), analyticsIdKey(userId), `${FIRST_EVENTS_PREFIX}:${userId}`]);
  preferencesByUser.delete(userId);
  firstEvents.delete(userId);
  pendingConsentGrants.delete(userId);
  snapshotCache.remove(userId);
  notify();
}

// Auth state can change before the request resolves. Tie success to the same
// attempt and scope so a late response can never reactivate a signed-out user.
export function beginAnalyticsAuth(properties: EventProperties["auth_started"]) {
  const attempt = ++authAttempt;
  capture("auth_started", properties);
  return attempt;
}
export async function recordAnalyticsAuthSucceeded(
  userId: string,
  attempt: number,
  properties: EventProperties["auth_succeeded"],
  accountCreated = false,
) {
  if (attempt !== authAttempt || completedAuthAttempt === attempt) return;
  if (activeUserId !== PREAUTH_SCOPE && activeUserId !== userId) return;
  try {
    if (activeUserId !== userId) await loadAnalyticsPreferences(userId);
    else await transition;
    // A duplicate auth-state render can enqueue the same scope again while the
    // initial restore resolves. Await the latest restore before accepting success.
    let pending: Promise<void>;
    do {
      pending = transition;
      await pending;
    } while (pending !== transition && activeUserId === userId && attempt === authAttempt);
    if (attempt !== authAttempt || activeUserId !== userId || completedAuthAttempt === attempt) return;
    completedAuthAttempt = attempt;
    if (accountCreated) capture("account_created", { method: "email" });
    capture("auth_succeeded", properties);
  } catch { /* Optional telemetry must never turn successful auth into an error. */ }
}

export async function flushAnalytics() {
  if (hasProductConsent() && posthog && appliedRevision === revision) {
    try { await posthog.flush(); } catch { /* SDK retains its queue for retry. */ }
  }
}

export function analyticsSnapshot(userId: string | null) {
  return snapshotCache.get(scopeKey(userId));
}

export function subscribeAnalytics(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function capture<K extends EventName>(event: K, properties: EventProperties[K]) {
  if (!hasProductConsent() || !posthog || appliedRevision !== revision) return false;
  try {
    posthog.capture(event, safeProperties({ ...baseProperties(), ...properties }));
    return true;
  } catch { return false; }
}

function captureFirst<K extends EventName>(event: K, properties: EventProperties[K]) {
  const scope = activeUserId;
  if (!scope || !hasProductConsent() || appliedRevision !== revision || !posthog) return;
  const seen = firstEvents.get(scope) ?? new Set<string>();
  if (seen.has(event)) return;
  if (!capture(event, properties)) return;
  seen.add(event);
  firstEvents.set(scope, seen);
  void AsyncStorage.setItem(`${FIRST_EVENTS_PREFIX}:${scope}`, JSON.stringify([...seen])).catch(() => {});
}

export const track = {
  appOpened: (p: EventProperties["app_opened"]) => capture("app_opened", p),
  screenViewed: (p: EventProperties["screen_viewed"]) => capture("screen_viewed", p),
  appActiveTime: (p: EventProperties["app_active_time"]) => capture("app_active_time", p),
  authStarted: (p: EventProperties["auth_started"]) => capture("auth_started", p),
  authSucceeded: (p: EventProperties["auth_succeeded"]) => capture("auth_succeeded", p),
  onboardingStarted: (p: EventProperties["onboarding_started"]) => capture("onboarding_started", p),
  onboardingStepViewed: (p: EventProperties["onboarding_step_viewed"]) => capture("onboarding_step_viewed", p),
  onboardingStepCompleted: (p: EventProperties["onboarding_step_completed"]) => capture("onboarding_step_completed", p),
  onboardingCompleted: (p: EventProperties["onboarding_completed"]) => capture("onboarding_completed", p),
  onboardingCancelled: (p: EventProperties["onboarding_cancelled"]) => capture("onboarding_cancelled", p),
  inviteCopied: () => {
    if (capture("invite_copied", {})) captureFirst("first_sweetmate_invited", { source: "invite_code" });
  },
  inviteShared: () => {
    if (capture("invite_shared", {})) captureFirst("first_sweetmate_invited", { source: "share" });
  },
  quickGuideCompleted: (p: EventProperties["quick_guide_completed"]) => capture("quick_guide_completed", p),
  choreUndone: (p: EventProperties["chore_undone"]) => capture("chore_undone", p),
  shoppingItemCompleted: () => capture("shopping_item_completed", {}),
  shoppingItemReopened: () => capture("shopping_item_reopened", {}),
  borrowingReturnRequested: () => capture("borrowing_return_requested", {}),
  borrowingReturnUndone: () => capture("borrowing_return_undone", {}),
  expenseRepaymentRecorded: (p: EventProperties["expense_repayment_recorded"]) => capture("expense_repayment_recorded", p),
  choreBatchCreated: (p: EventProperties["chore_batch_created"]) => {
    if (capture("chore_batch_created", p)) captureFirst("first_chore_created", { source: "bulk" });
  },
  chorePlanCreated: (p: EventProperties["chore_plan_created"]) => capture("chore_plan_created", p),
  chorePlanApplied: (p: EventProperties["chore_plan_applied"]) => {
    if (capture("chore_plan_applied", p)) captureFirst("first_chore_created", { source: "chart" });
  },
  shortlistSentToShopping: (p: EventProperties["shortlist_sent_to_shopping"]) => capture("shortlist_sent_to_shopping", p),
  accountCreated: () => capture("account_created", { method: "email" }),
  sweetCreated: (properties: EventProperties["sweet_created"]) =>
    capture("sweet_created", properties),
  sweetJoined: (properties: EventProperties["sweet_joined"]) =>
    capture("sweet_joined", properties),
  sweetSwitched: (properties: EventProperties["sweet_switched"]) =>
    capture("sweet_switched", properties),
  choreCreated: (properties: EventProperties["chore_created"]) => {
    if (capture("chore_created", properties)) captureFirst("first_chore_created", { ...properties, source: "individual" });
  },
  choreCompleted: (properties: EventProperties["chore_completed"]) => {
    if (capture("chore_completed", properties)) captureFirst("first_chore_completed", properties);
  },
  choreDeleted: (properties: EventProperties["chore_deleted"]) =>
    capture("chore_deleted", properties),
  shoppingListCreated: () => capture("shopping_list_created", {}),
  shoppingItemAdded: () => capture("shopping_item_added", {}),
  expenseCreated: (properties: EventProperties["expense_created"]) =>
    capture("expense_created", properties),
  iouSettled: (properties: EventProperties["iou_settled"]) => capture("iou_settled", properties),
  borrowingItemAdded: () => capture("borrowing_item_added", {}),
  borrowingItemReturned: () => capture("borrowing_item_returned", {}),
  nudgeSent: (properties: EventProperties["nudge_sent"]) =>
    capture("nudge_sent", properties),
  calendarExported: (properties: EventProperties["calendar_exported"]) =>
    capture("calendar_exported", properties),
  quickGuideOpened: (properties: EventProperties["quick_guide_opened"]) =>
    capture("quick_guide_opened", properties),
  workflowFailed: (properties: EventProperties["workflow_failed"]) =>
    capture("workflow_failed", properties),
  performanceTiming: (properties: EventProperties["performance_timing"]) =>
    capture("performance_timing", properties),
  shortlistOpened: (properties: EventProperties["shortlist_opened"]) =>
    capture("shortlist_opened", properties),
  shortlistSaved: (properties: EventProperties["shortlist_saved"]) =>
    capture("shortlist_saved", properties),
};

export function captureDiagnosticException(
  error: unknown,
  action: string,
  context?: Record<string, unknown>,
) {
  if (!hasCrashConsent() || !sentryInitialized || appliedRevision !== revision) return;
  Sentry.withScope((scope) => {
    scope.setTag("action", action);
    scope.setExtras(
      safeProperties(
        Object.fromEntries(
          Object.entries(context ?? {}).filter(([, value]) =>
            ["string", "number", "boolean"].includes(typeof value),
          ),
        ) as Record<string, SafeValue>,
      ),
    );
    Sentry.captureException(error);
  });
}
