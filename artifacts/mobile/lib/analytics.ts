import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import { Platform } from "react-native";
import PostHog from "posthog-react-native";
import * as Sentry from "@sentry/react-native";

import { createExternalStoreSnapshotCache } from "@/lib/externalStoreSnapshot";

export const PRIVACY_NOTICE_VERSION = "2026-07-26";

export type AnalyticsPreferences = {
  productAnalyticsEnabled: boolean;
  crashReportingEnabled: boolean;
  noticeVersion: string | null;
};

type EventProperties = {
  account_created: { method: "email" };
  first_sweetmate_invited: { source: "invite_code" | "share" };
  first_chore_created: { recurring: boolean };
  first_chore_completed: { recurring: boolean };
  sweet_created: { source: "setup" | "settings" };
  sweet_joined: { source: "invite" | "setup" };
  sweet_switched: { destination: "existing" | "new" };
  chore_created: { recurring: boolean };
  chore_completed: { recurring: boolean };
  chore_deleted: { recurring: boolean };
  chore_reassigned: { assignment_mode: "specific_person" | "round_robin" | "unassigned" };
  chore_plan_created: { source: "manual" | "generated" };
  invite_copied: Record<string, never>;
  invite_shared: Record<string, never>;
  shopping_list_created: Record<string, never>;
  shopping_item_added: Record<string, never>;
  expense_created: { recurring: boolean };
  shopping_expense_created: Record<string, never>;
  iou_created: { split_mode: "equal" | "custom" };
  iou_settled: Record<string, never>;
  borrowing_item_added: Record<string, never>;
  borrowing_item_returned: Record<string, never>;
  nudge_sent: { channel: "in_app" | "push" };
  calendar_exported: { item_type: "chore" | "shopping" | "expense" };
  quick_guide_opened: { source: "settings" | "onboarding" };
  quick_guide_completed: { source: "settings" | "onboarding" };
  workflow_failed: {
    feature: "auth" | "household" | "chore" | "shopping" | "expense" | "calendar" | "storage" | "sync";
    operation: string;
    error_category: "network" | "permission" | "validation" | "server" | "storage" | "unknown";
  };
  performance_timing: {
    operation: "cold_launch" | "warm_launch" | "storage_hydration" | "tab_ready" | "sweet_switch" | "mutation_visible" | "server_sync";
    duration_bucket: "under_250ms" | "250ms_1s" | "1s_3s" | "over_3s";
    visit: "first" | "repeat" | "not_applicable";
  };
  shortlist_opened: { source: "sweet_essentials" };
  shortlist_saved: {
    item_count_bucket: "1_5" | "6_10" | "11_plus";
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
const listeners = new Set<() => void>();
const loadedUsers = new Set<string>();
const preferencesByUser = new Map<string, AnalyticsPreferences>();
let activeUserId: string | null = null;
let posthog: PostHog | null = null;
let sentryInitialized = false;

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
    if (deniedKeys.test(key)) {
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

async function applyPreferences(userId: string) {
  const preferences = preferencesByUser.get(userId) ?? DEFAULT_PREFERENCES;
  const id = await opaqueId(userId);
  const posthogKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
  if (preferences.productAnalyticsEnabled && posthogKey) {
    posthog ??= new PostHog(posthogKey, {
      host: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
      captureAppLifecycleEvents: false,
      enableSessionReplay: false,
    });
    // The SDK persists opt-out across client instances. Restore the user's
    // explicit consent before identifying them or capturing further events.
    await posthog.optIn();
    posthog.identify(id, baseProperties());
  } else if (posthog) {
    await posthog.reset();
    await posthog.optOut();
    posthog = null;
  }

  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (preferences.crashReportingEnabled && dsn && !sentryInitialized) {
    Sentry.init({
      dsn,
      environment,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      enableAutoSessionTracking: false,
      beforeBreadcrumb: (breadcrumb) =>
        breadcrumb.category === "console" ||
        breadcrumb.category === "http" ||
        breadcrumb.category === "xhr"
          ? null
          : breadcrumb,
      beforeSend: (event) => {
        if (!currentPreferences().crashReportingEnabled) return null;
        delete event.request;
        delete event.message;
        for (const value of event.exception?.values ?? []) {
          // Preserve exception type and frames without free-form error text.
          value.value = "Application error";
        }
        if (event.user) event.user = { id };
        event.extra = safeProperties(
          Object.fromEntries(
            Object.entries(event.extra ?? {}).filter(([, value]) =>
              ["string", "number", "boolean"].includes(typeof value),
            ),
          ) as Record<string, SafeValue>,
        );
        return event;
      },
    });
    Sentry.setUser({ id });
    Sentry.setTags(baseProperties() as Record<string, string>);
    sentryInitialized = true;
  } else if (!preferences.crashReportingEnabled && sentryInitialized) {
    Sentry.setUser(null);
  }
}

export async function loadAnalyticsPreferences(userId: string) {
  activeUserId = userId;
  const raw = await AsyncStorage.getItem(preferenceKey(userId));
  let preferences = DEFAULT_PREFERENCES;
  if (raw) {
    try {
      preferences = { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) };
    } catch {
      // Invalid local state safely falls back to no collection.
    }
  }
  preferencesByUser.set(userId, preferences);
  loadedUsers.add(userId);
  snapshotCache.publish(userId, true, preferences);
  notify();
  await applyPreferences(userId);
}

export async function saveAnalyticsPreferences(
  userId: string,
  update: Partial<AnalyticsPreferences>,
) {
  const next = {
    ...(preferencesByUser.get(userId) ?? DEFAULT_PREFERENCES),
    ...update,
  };
  preferencesByUser.set(userId, next);
  await AsyncStorage.setItem(preferenceKey(userId), JSON.stringify(next));
  snapshotCache.publish(userId, true, next);
  notify();
  await applyPreferences(userId);
}

export async function resetAnalyticsIdentity() {
  activeUserId = null;
  if (posthog) await posthog.reset();
  posthog = null;
  Sentry.setUser(null);
}

export async function deleteLocalAnalyticsIdentity(userId: string) {
  await resetAnalyticsIdentity();
  await AsyncStorage.multiRemove([preferenceKey(userId), analyticsIdKey(userId)]);
  preferencesByUser.delete(userId);
  loadedUsers.delete(userId);
  snapshotCache.remove(userId);
  notify();
}

export function analyticsSnapshot(userId: string | null) {
  return snapshotCache.get(userId);
}

export function subscribeAnalytics(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function capture<K extends EventName>(event: K, properties: EventProperties[K]) {
  if (!currentPreferences().productAnalyticsEnabled || !posthog) return;
  posthog.capture(event, safeProperties({ ...baseProperties(), ...properties }));
}

export const track = {
  accountCreated: () => capture("account_created", { method: "email" }),
  sweetCreated: (properties: EventProperties["sweet_created"]) =>
    capture("sweet_created", properties),
  sweetJoined: (properties: EventProperties["sweet_joined"]) =>
    capture("sweet_joined", properties),
  sweetSwitched: (properties: EventProperties["sweet_switched"]) =>
    capture("sweet_switched", properties),
  choreCreated: (properties: EventProperties["chore_created"]) =>
    capture("chore_created", properties),
  choreCompleted: (properties: EventProperties["chore_completed"]) =>
    capture("chore_completed", properties),
  choreDeleted: (properties: EventProperties["chore_deleted"]) =>
    capture("chore_deleted", properties),
  shoppingListCreated: () => capture("shopping_list_created", {}),
  shoppingItemAdded: () => capture("shopping_item_added", {}),
  expenseCreated: (properties: EventProperties["expense_created"]) =>
    capture("expense_created", properties),
  iouSettled: () => capture("iou_settled", {}),
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
  if (!currentPreferences().crashReportingEnabled || !sentryInitialized) return;
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
