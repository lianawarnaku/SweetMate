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
  capture(event: string, properties: Record<string, unknown>) {
    if (!persistedOptOut) events.push({ event, properties });
  }
}

const modules: Record<string, unknown> = {
  "@react-native-async-storage/async-storage": {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => { storage.set(key, value); },
    multiRemove: async (keys: string[]) => { keys.forEach((key) => storage.delete(key)); },
  },
  "expo-application": { nativeApplicationVersion: "test", nativeBuildVersion: "test" },
  "react-native": { Platform: { OS: "test" } },
  "posthog-react-native": PostHogStub,
  "@sentry/react-native": {
    init: () => { diagnosticInitializations += 1; },
    setUser: () => {},
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
  process: { env: { EXPO_PUBLIC_POSTHOG_API_KEY: "test-only", EXPO_PUBLIC_APP_ENV: "test" } },
  __DEV__: false,
  console,
});
const analytics = exports as typeof import("./analytics");

await analytics.loadAnalyticsPreferences("test-user");
analytics.track.choreCreated({ recurring: false });
assert.equal(clientOptions.length, 0, "default-off must not initialize PostHog");
assert.equal(events.length, 0, "default-off must not capture events");

await analytics.saveAnalyticsPreferences("test-user", { productAnalyticsEnabled: true });
const properties = { recurring: true, email: "private", title: "private", invite_code: "private" };
analytics.track.choreCreated(properties);
assert.equal(events.length, 1, "explicit consent must allow cataloged events");
assert.equal(events[0].properties.recurring, true);
assert.equal(events[0].properties.environment, "test");
for (const key of ["email", "title", "invite_code"]) {
  assert(!(key in events[0].properties), `sensitive ${key} must remain filtered`);
}
const originalIdentity = identified[0];
assert(originalIdentity.startsWith("sm_"), "identity must remain opaque");
assert.notEqual(originalIdentity, "test-user");

await analytics.saveAnalyticsPreferences("test-user", { productAnalyticsEnabled: false });
assert.equal(persistedOptOut, true, "disabling must persist vendor opt-out");
analytics.track.choreCreated({ recurring: false });
assert.equal(events.length, 1, "disabled consent must stop captures");

await analytics.saveAnalyticsPreferences("test-user", { productAnalyticsEnabled: true });
analytics.track.choreCompleted({ recurring: true });
assert.equal(clientOptions.length, 2, "re-enabling must restore a fresh client");
assert.equal(optInCalls, 2, "each consented client must clear a previous persistent opt-out");
assert.equal(events.length, 2, "events must resume after consent is restored");
assert.equal(identified[1], originalIdentity, "restored consent must use the user's opaque identity");
assert(clientOptions.every((options) => options.enableSessionReplay === false));
assert(clientOptions.every((options) => options.captureAppLifecycleEvents === false));
assert.equal(diagnosticInitializations, 0, "analytics consent must not enable crash reporting");

await analytics.resetAnalyticsIdentity();
analytics.track.choreCreated({ recurring: false });
assert.equal(events.length, 2, "sign-out must stop captures");
await analytics.loadAnalyticsPreferences("another-user");
analytics.track.choreCreated({ recurring: false });
assert.equal(events.length, 2, "another user's default-off preference must be respected");

console.log("analytics consent tests passed");
