import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import { createExternalStoreSnapshotCache } from "./externalStoreSnapshot.ts";

// Exercise the actual analytics boundary with local storage and vendor stubs.
// No SDK is initialized and no network requests are made by this test.
const storage = new Map<string, string>();
const events: { event: string; properties: Record<string, unknown> }[] = [];
const identified: string[] = [];
const clientOptions: Record<string, unknown>[] = [];
let persistedOptOut = false;
let optInCalls = 0;
let diagnosticInitializations = 0;
let diagnosticOptions: any = null;
let sentryUser: any = null;
let flushes = 0;
let failNextStorageWrite = false;

class PostHogStub {
  constructor(_key: string, options: Record<string, unknown>) {
    clientOptions.push(options);
  }
  async optIn() {
    persistedOptOut = false;
    optInCalls += 1;
  }
  async optOut() {
    persistedOptOut = true;
  }
  reset() {
    persistedOptOut = false;
  }
  identify(id: string) {
    if (!persistedOptOut) identified.push(id);
  }
  async flush() { flushes += 1; }
  capture(event: string, properties: Record<string, unknown>) {
    if (!persistedOptOut) events.push({ event, properties });
  }
}

const modules: Record<string, unknown> = {
  "@react-native-async-storage/async-storage": {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      if (failNextStorageWrite) { failNextStorageWrite = false; throw new Error("test storage unavailable"); }
      storage.set(key, value);
    },
    multiRemove: async (keys: string[]) => { keys.forEach((key) => storage.delete(key)); },
  },
  "expo-application": { nativeApplicationVersion: "test", nativeBuildVersion: "test" },
  "react-native": { Platform: { OS: "test" } },
  "posthog-react-native": PostHogStub,
  "@sentry/react-native": {
    init: (options: unknown) => { diagnosticInitializations += 1; diagnosticOptions = options; },
    setUser: (user: unknown) => { sentryUser = user; },
    setTags: () => {},
  },
  "@/lib/externalStoreSnapshot": { createExternalStoreSnapshotCache },
};
const source = readFileSync(resolve(process.cwd(), "lib/analytics.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const exports: Record<string, unknown> = {};
runInNewContext(compiled, {
  exports,
  require: (name: string) => {
    assert(name in modules, `unexpected module: ${name}`);
    return modules[name];
  },
  process: { env: { EXPO_PUBLIC_POSTHOG_API_KEY: "test-only", EXPO_PUBLIC_APP_ENV: "test", EXPO_PUBLIC_SENTRY_DSN: "test-only" } },
  __DEV__: false,
  console,
});
const analytics = exports as typeof import("./analytics");

const version = analytics.PRIVACY_NOTICE_VERSION;
const consent = { productAnalyticsEnabled: true, crashReportingEnabled: false, noticeVersion: version };
const count = (name: string) => events.filter((event) => event.event === name).length;

// No collection or client exists before the pre-auth explicit choice.
await analytics.loadAnalyticsPreferences(null);
analytics.track.appOpened({ launch_type: "cold" });
assert.equal(clientOptions.length, 0);
assert.equal(events.length, 0);
const initial = analytics.analyticsSnapshot(null);
assert.equal(initial.loaded, true);
assert.equal(initial.preferences.productAnalyticsEnabled, false);

failNextStorageWrite = true;
await assert.rejects(analytics.saveAnalyticsPreferences(null, consent), /storage unavailable/);
assert.equal(analytics.analyticsSnapshot(null).loaded, true, "failed save must allow the privacy choice to be retried");
assert.equal(events.length, 0, "failed consent persistence must not start collection");
await analytics.saveAnalyticsPreferences(null, consent);
assert.equal(events[0].event, "analytics_consent_granted", "first custom event must follow explicit consent");
assert.equal(events[0].properties.source, "before_auth");
const anonymousIdentity = identified.at(-1);
assert(anonymousIdentity?.startsWith("sm_"));
assert.equal(diagnosticInitializations, 0, "product opt-in must not enable Sentry");
const attempt = analytics.beginAnalyticsAuth({ method: "email", mode: "signup" });
// Simulate AuthGate observing auth before the signup promise completes.
const restoring = analytics.loadAnalyticsPreferences("new-user");
await analytics.recordAnalyticsAuthSucceeded("new-user", attempt, { method: "email", mode: "signup" }, true);
await restoring;
assert.equal(identified.at(-1), anonymousIdentity, "signup funnel must keep the opted-in pre-auth identity");
assert.equal(count("account_created"), 1);
await analytics.recordAnalyticsAuthSucceeded("new-user", attempt, { method: "email", mode: "signup" }, true);
assert.equal(count("account_created"), 1, "duplicate auth callbacks must not double count signup");

const properties = { recurring: true, email: "private", title: "private", invite_code: "private", shopping_item: "private", content_label: "private", content: "private" };
analytics.track.choreCreated(properties);
analytics.track.choreCreated(properties);
assert.equal(count("chore_created"), 2);
assert.equal(count("first_chore_created"), 1);
const creation = events.find((event) => event.event === "chore_created")!;
assert.equal(creation.properties.environment, "test");
assert.equal(creation.properties.analytics_schema_version, 2);
for (const key of ["email", "title", "invite_code", "shopping_item", "content_label", "content"]) assert(!(key in creation.properties));
analytics.track.shortlistSaved({ source: "sweet_essentials", category_count: 2, item_count_bucket: "0" });
assert.equal(events.at(-1)!.properties.item_count_bucket, "0", "approved item aggregate must survive filtering");
assert.equal(analytics.analyticsCountBucket(0), "0");
assert.equal(analytics.analyticsCountBucket(11), "11_plus");

const beforeRevoke = events.length;
const revoking = analytics.saveAnalyticsPreferences("new-user", { productAnalyticsEnabled: false });
analytics.track.choreCompleted({ recurring: false });
assert.equal(events.length, beforeRevoke, "revocation must stop capture immediately, before storage resolves");
await revoking;
assert.equal(persistedOptOut, true);
const grantsBeforeRapidSave = count("analytics_consent_granted");
await Promise.all([
  analytics.saveAnalyticsPreferences("new-user", { productAnalyticsEnabled: true }),
  analytics.saveAnalyticsPreferences("new-user", { crashReportingEnabled: false }),
]);
assert.equal(count("analytics_consent_granted"), grantsBeforeRapidSave + 1, "rapid saves must retain the explicit product consent event");
assert.equal(identified.at(-1), anonymousIdentity);
analytics.track.choreCompleted({ recurring: false });
analytics.track.choreCompleted({ recurring: false });
assert.equal(count("first_chore_completed"), 1);
await analytics.flushAnalytics();
assert.equal(flushes, 1);
assert(clientOptions.every((options) => options.enableSessionReplay === false && options.captureAppLifecycleEvents === false && options.defaultOptIn === false));
assert(optInCalls >= 2);
// Exercise the actual hooks handed to the pinned SDK, including identity and
// nested legacy properties. No live vendor event or historical record is used.
for (const options of clientOptions) {
  assert.equal(options.disableGeoip, true);
  const beforeSend = options.before_send as (event: any) => any;
  assert.equal(beforeSend(null), null);
  const timestamp = new Date("2026-11-27T12:00:00Z");
  const event = { event: "privacy_test", timestamp, properties: {
    token: "test-only", $ip: "192.0.2.1", $geoip_country_name: "Test",
    $initial_geoip_latitude: 1, $timezone: "Test/Zone", $locale: "en-US",
    homeLocation: { latitude: 1, longitude: 2 }, recurring: true,
    nested: [{ city: "Test", frequency: "weekly" }], $geoip_disable: false,
    $set: { $initial_geoip_city_name: "Test", app_version: "test" },
  }, $set_once: { longitude: 2, platform: "test" } };
  const cleaned = beforeSend(event);
  assert.equal(cleaned.timestamp, timestamp);
  assert.equal(cleaned.event, "privacy_test");
  assert.equal(cleaned.properties.token, "test-only");
  assert.equal(cleaned.properties.recurring, true);
  assert.equal(cleaned.properties.$geoip_disable, true);
  assert.equal(cleaned.properties.$ip, undefined);
  assert.equal(cleaned.properties.$geoip_country_name, undefined);
  assert.equal(cleaned.properties.$initial_geoip_latitude, undefined);
  assert.equal(cleaned.properties.$timezone, undefined);
  assert.equal(cleaned.properties.$locale, undefined);
  assert.equal(cleaned.properties.homeLocation, undefined);
  assert.equal(cleaned.properties.nested[0].city, undefined);
  assert.equal(cleaned.properties.nested[0].frequency, "weekly");
  assert.equal(cleaned.properties.$set.$initial_geoip_city_name, undefined);
  assert.equal(cleaned.$set_once.longitude, undefined);
  assert.equal(cleaned.$set_once.platform, "test");
  assert.equal(event.properties.$ip, "192.0.2.1", "sanitization must not mutate shared input");
  const appProperties = (options.customAppProperties as Function)({
    $timezone: "Test/Zone", $locale: "en-US", $os_name: "test", $app_build: "test",
  });
  assert.equal(appProperties.$timezone, undefined);
  assert.equal(appProperties.$locale, undefined);
  assert.equal(appProperties.$os_name, "test");
}


// Rapid independent toggles merge. A stale re-enable never initializes a client.
await Promise.all([
  analytics.saveAnalyticsPreferences("new-user", { productAnalyticsEnabled: false }),
  analytics.saveAnalyticsPreferences("new-user", { crashReportingEnabled: true }),
]);
assert.equal(analytics.analyticsSnapshot("new-user").preferences.productAnalyticsEnabled, false);
assert.equal(analytics.analyticsSnapshot("new-user").preferences.crashReportingEnabled, true);
assert.equal(diagnosticInitializations, 1);
const newUserDiagnosticId = sentryUser.id;
const cleaned = diagnosticOptions.beforeSend({ user: { id: newUserDiagnosticId }, request: { data: "private" }, message: "private", exception: { values: [{ value: "private" }] }, extra: { shopping_item: "private", count: 2 } });
assert.equal(cleaned.request, undefined);
assert.equal(cleaned.message, undefined);
assert.equal(cleaned.exception.values[0].value, "Application error");
assert.equal(cleaned.extra.shopping_item, undefined);
assert.equal(cleaned.extra.count, 2);

// A newly signed-out person gets a fresh choice, rather than inherited consent.
await analytics.loadAnalyticsPreferences(null);
assert.equal(analytics.analyticsSnapshot(null).preferences.noticeVersion, null);
const stopped = events.length;
analytics.track.shoppingItemAdded();
assert.equal(events.length, stopped);
const lateAttempt = analytics.beginAnalyticsAuth({ method: "email", mode: "signup" });
await analytics.resetAnalyticsIdentity();
await analytics.recordAnalyticsAuthSucceeded("stale-user", lateAttempt, { method: "email", mode: "signup" }, true);
assert.equal(count("account_created"), 1, "late signup callback must not revive a signed-out scope");

// A fresh Don't share choice overrides this device's earlier account opt-in.
await analytics.loadAnalyticsPreferences(null);
await analytics.saveAnalyticsPreferences(null, { ...consent, productAnalyticsEnabled: false });
storage.set("sweetmate:telemetry-preferences:v1:old-opt-in", JSON.stringify(consent));
await analytics.loadAnalyticsPreferences("old-opt-in");
assert.equal(analytics.analyticsSnapshot("old-opt-in").preferences.productAnalyticsEnabled, false);
analytics.track.shoppingItemAdded();
assert.equal(events.length, stopped);

// Older narrower consent stays paused until explicit renewed product consent.
storage.set("sweetmate:telemetry-preferences:v1:legacy", JSON.stringify({ ...consent, noticeVersion: "2026-07-26" }));
await analytics.loadAnalyticsPreferences("legacy");
analytics.track.appOpened({ launch_type: "cold" });
await analytics.saveAnalyticsPreferences("legacy", { crashReportingEnabled: true });
assert.equal(analytics.analyticsSnapshot("legacy").preferences.noticeVersion, "2026-07-26");
assert.equal(events.length, stopped, "crash toggle must not silently expand old product consent");
await analytics.saveAnalyticsPreferences("legacy", consent);
analytics.track.appOpened({ launch_type: "consent" });
assert.equal(count("app_opened"), 1);

// Superseded queued account loads must not transfer consent or capture as A.
await analytics.loadAnalyticsPreferences(null);
await analytics.saveAnalyticsPreferences(null, consent);
const loads = [analytics.loadAnalyticsPreferences("superseded-A"), analytics.loadAnalyticsPreferences("current-B")];
await Promise.all(loads);
assert.equal(storage.has("sweetmate:telemetry-preferences:v1:superseded-A"), false);
assert.equal(analytics.analyticsSnapshot("current-B").preferences.productAnalyticsEnabled, false);

// Diagnostic identity rebinds for each separately opted-in account.
await analytics.saveAnalyticsPreferences("current-B", { ...consent, crashReportingEnabled: true });
assert.notEqual(sentryUser.id, newUserDiagnosticId);
assert.equal(diagnosticInitializations, 1, "Sentry initialization may be reused but its user must change");
assert.equal(diagnosticOptions.beforeSend({ user: { id: newUserDiagnosticId } }), null, "queued exception from another account must be discarded");
const bId = sentryUser.id;
assert.equal(diagnosticOptions.beforeSend({}).user.id, bId);
await analytics.deleteLocalAnalyticsIdentity("current-B");
assert.equal(storage.has("sweetmate:analytics-id:v1:current-B"), false);
const deletedCount = events.length;
analytics.track.shoppingItemAdded();
assert.equal(events.length, deletedCount);
assert.equal(diagnosticOptions.beforeSend({}), null);
// Signup checkbox: consent belongs only to the successful account/attempt.
await analytics.loadAnalyticsPreferences(null, { resetAnonymous: true });
const signupAttempt = analytics.beginAnalyticsAuth({ method: "email", mode: "signup" });
await analytics.loadAnalyticsPreferences("checkbox-opt-in");
await analytics.saveSignupAnalyticsConsent("checkbox-opt-in", true, signupAttempt, true);
assert.equal(analytics.analyticsSnapshot("checkbox-opt-in").preferences.productAnalyticsEnabled, true);
assert.equal(analytics.analyticsSnapshot("checkbox-opt-in").preferences.crashReportingEnabled, true);
assert.equal(events.at(-1)?.properties.source, "signup");

await analytics.loadAnalyticsPreferences(null, { resetAnonymous: true });
const uncheckedAttempt = analytics.beginAnalyticsAuth({ method: "email", mode: "signup" });
await analytics.loadAnalyticsPreferences("checkbox-unchecked");
const beforeUnchecked = events.length;
await analytics.saveSignupAnalyticsConsent("checkbox-unchecked", false, uncheckedAttempt, true);
await analytics.recordAnalyticsAuthSucceeded("checkbox-unchecked", uncheckedAttempt, { method: "email", mode: "signup" }, true);
assert.equal(analytics.analyticsSnapshot("checkbox-unchecked").preferences.noticeVersion, version);
assert.equal(analytics.analyticsSnapshot("checkbox-unchecked").preferences.productAnalyticsEnabled, false);
assert.equal(analytics.analyticsSnapshot("checkbox-unchecked").preferences.crashReportingEnabled, false);
assert.equal(events.length, beforeUnchecked, "unchecked signup must succeed without optional collection");

// Social signup returning an existing user must preserve their independent choices.
await analytics.loadAnalyticsPreferences(null, { resetAnonymous: true });
storage.set("sweetmate:telemetry-preferences:v1:existing-social", JSON.stringify({ productAnalyticsEnabled: false, crashReportingEnabled: true, noticeVersion: version }));
const existingAttempt = analytics.beginAnalyticsAuth({ method: "google", mode: "signup" });
await analytics.loadAnalyticsPreferences("existing-social");
await analytics.saveSignupAnalyticsConsent("existing-social", true, existingAttempt, true);
assert.equal(analytics.analyticsSnapshot("existing-social").preferences.productAnalyticsEnabled, false);
assert.equal(analytics.analyticsSnapshot("existing-social").preferences.crashReportingEnabled, true);

// Email confirmation stages the choice without enabling an anonymous SDK session.
await analytics.loadAnalyticsPreferences(null, { resetAnonymous: true });
const pendingAttempt = analytics.beginAnalyticsAuth({ method: "email", mode: "signup" });
const beforePending = events.length;
await analytics.saveSignupAnalyticsConsent("confirmation-pending", true, pendingAttempt, false);
assert.equal(events.length, beforePending);
assert.equal(analytics.analyticsSnapshot(null).preferences.productAnalyticsEnabled, false);
assert.equal(JSON.parse(storage.get("sweetmate:telemetry-preferences:v1:confirmation-pending")!).crashReportingEnabled, true);
await analytics.loadAnalyticsPreferences("confirmation-pending");
assert.equal(analytics.analyticsSnapshot("confirmation-pending").preferences.productAnalyticsEnabled, true);
assert.equal(analytics.analyticsSnapshot("confirmation-pending").preferences.crashReportingEnabled, true);

await analytics.loadAnalyticsPreferences(null, { resetAnonymous: true });
const staleCheckboxAttempt = analytics.beginAnalyticsAuth({ method: "apple", mode: "signup" });
await analytics.loadAnalyticsPreferences("signed-out-checkbox");
await analytics.loadAnalyticsPreferences(null, { resetAnonymous: true });
await analytics.saveSignupAnalyticsConsent("signed-out-checkbox", true, staleCheckboxAttempt, true);
assert.equal(storage.has("sweetmate:telemetry-preferences:v1:signed-out-checkbox"), false, "late signup callback cannot enable collection after sign-out");

const failureAttempt = analytics.beginAnalyticsAuth({ method: "email", mode: "signup" });
await analytics.loadAnalyticsPreferences("checkbox-save-failure");
failNextStorageWrite = true;
await assert.rejects(analytics.saveSignupAnalyticsConsent("checkbox-save-failure", true, failureAttempt, true), /storage unavailable/);
assert.equal(analytics.analyticsSnapshot("checkbox-save-failure").preferences.productAnalyticsEnabled, false);
assert.equal(analytics.analyticsSnapshot("checkbox-save-failure").preferences.crashReportingEnabled, false);

// Legacy pre-auth consent cannot be inherited on the new signed-out screen.
await analytics.loadAnalyticsPreferences(null);
await analytics.saveAnalyticsPreferences(null, { ...consent, crashReportingEnabled: true });
await analytics.loadAnalyticsPreferences(null, { resetAnonymous: true });
assert.equal(analytics.analyticsSnapshot(null).preferences.productAnalyticsEnabled, false);
assert.equal(analytics.analyticsSnapshot(null).preferences.crashReportingEnabled, false);
assert.equal(storage.has("sweetmate:telemetry-preferences:v1:signed-out"), false);
console.log("analytics consent, signup checkbox, identity, activation, and privacy tests passed");

// The production release gate stays off until the matching public policy is live.
assert.equal(analytics.ITEM_NAME_ANALYTICS_AVAILABLE, false);
await assert.rejects(analytics.saveAnalyticsPreferences("release-gated", {
  ...consent, itemNamesEnabled: true, itemNamesNoticeVersion: analytics.ITEM_NAME_NOTICE_VERSION,
}), /Name sharing/);
assert.equal(analytics.prepareItemNameAnalytics("shopping", "manual", ["Milk"])(), 0);

// An explicitly enabled build still needs a separate, current per-account choice.
const contentExports: any = {};
runInNewContext(compiled, { exports: contentExports,
  require: (name: string) => { assert(name in modules); return modules[name]; },
  process: { env: { EXPO_PUBLIC_POSTHOG_API_KEY: "test-only", EXPO_PUBLIC_APP_ENV: "test", EXPO_PUBLIC_ITEM_NAME_ANALYTICS_ENABLED: "true" } },
  __DEV__: false, console,
});
const content = contentExports as typeof import("./analytics");
await content.loadAnalyticsPreferences("content-user");
await content.saveAnalyticsPreferences("content-user", consent);
const oldAction = content.prepareItemNameAnalytics("chore", "manual", ["Before consent"]);
assert.equal(content.analyticsSnapshot("content-user").preferences.itemNamesEnabled, false);
const allowNames = { itemNamesEnabled: true, itemNamesNoticeVersion: content.ITEM_NAME_NOTICE_VERSION };
await content.saveAnalyticsPreferences("content-user", allowNames);
assert.equal(oldAction(), 0, "opting in cannot backfill an earlier action");
const named = () => events.filter(event => event.event === "item_name_added");
const baselineNames = named().length;
const reportNames = content.prepareItemNameAnalytics("chore", "manual", ["Wash dishes", "Wash dishes", "   Tidy\nroom  ", "", "a".repeat(121), "test@example.com", "https://private.invalid", "password:secret", "1234567890123456"]);
assert.equal(reportNames(), 2);
assert.equal(reportNames(), 0, "an acknowledgement closure is one-shot");
assert.deepEqual(named().slice(baselineNames).map(event => event.properties.content_label), ["Wash dishes", "Tidy room"]);
for (const kind of ["expense", "shopping"] as const) assert.equal(content.prepareItemNameAnalytics(kind, "manual", ["Milk"])(), 1);
assert.equal(content.prepareItemNameAnalytics("chore", "google" as any, ["Private Google event"])(), 0);
assert.equal(content.prepareItemNameAnalytics("unknown" as any, "manual", ["Unknown"] )(), 0);
const beforeOff = content.prepareItemNameAnalytics("expense", "manual", ["Awaiting save"]);
const revokeNames = content.saveAnalyticsPreferences("content-user", { itemNamesEnabled: false });
assert.equal(beforeOff(), 0, "revocation blocks a pending acknowledgement immediately");
await revokeNames;
assert.equal(content.prepareItemNameAnalytics("shopping", "manual", ["Off"])(), 0);
await content.saveAnalyticsPreferences("content-user", allowNames);
const switched = content.prepareItemNameAnalytics("expense", "manual", ["Original account"]);
await content.loadAnalyticsPreferences("other-content-user");
assert.equal(switched(), 0, "late saves never attribute content to a different account");
assert.equal(content.analyticsSnapshot("other-content-user").preferences.itemNamesEnabled, false);
await content.loadAnalyticsPreferences("content-user");
await content.saveAnalyticsPreferences("content-user", { productAnalyticsEnabled: false });
assert.equal(content.analyticsSnapshot("content-user").preferences.itemNamesEnabled, false);
await content.saveAnalyticsPreferences("content-user", consent);
assert.equal(content.prepareItemNameAnalytics("chore", "manual", ["Still off"])(), 0, "product re-enable does not revive name sharing");
failNextStorageWrite = true;
await assert.rejects(content.saveAnalyticsPreferences("content-user", allowNames));
assert.equal(content.prepareItemNameAnalytics("chore", "manual", ["Failed consent save"])(), 0);
storage.set("sweetmate:telemetry-preferences:v1:old-content-notice", JSON.stringify({ ...consent, itemNamesEnabled: true, itemNamesNoticeVersion: "old" }));
await content.loadAnalyticsPreferences("old-content-notice");
assert.equal(content.prepareItemNameAnalytics("chore", "manual", ["Old notice"])(), 0);
await content.loadAnalyticsPreferences(null);
await assert.rejects(content.saveAnalyticsPreferences(null, { ...consent, ...allowNames }), /Name sharing/);
console.log("Separate name consent, release gate, no backfill, revision/account guards and bounded content filtering passed");
