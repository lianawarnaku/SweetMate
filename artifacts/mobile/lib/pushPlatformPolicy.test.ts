import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(readFileSync("components/PushNotificationManager.native.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: false },
}).outputText;
async function settle() { for (let index = 0; index < 30; index++) await Promise.resolve(); }
async function fixture(os: "android" | "ios", options: { userId?: string | null; device?: boolean; granted?: boolean; request?: boolean; cleanupFailure?: boolean } = {}) {
  const calls = { handler: 0, permission: 0, request: 0, token: 0, registration: [] as unknown[][], unregister: 0, listeners: 0, removals: 0, errors: [] as string[] };
  let effect!: () => (() => void) | undefined, foreground!: (state: string) => void;
  const listener = () => { calls.listeners++; return { remove: () => calls.removals++ }; };
  const exports: any = {};
  const granted = options.granted ?? true;
  runInNewContext(code, { exports, setTimeout: () => 1, clearTimeout: () => {}, require: (name: string) => {
    if (name === "react") return { useEffect: (fn: any) => { effect = fn; } };
    if (name === "react-native") return { Platform: { OS: os }, AppState: { addEventListener: (_name: string, fn: any) => { foreground = fn; return listener(); } } };
    if (name === "expo-device") return { isDevice: options.device ?? true };
    if (name === "expo-constants") return { default: { easConfig: { projectId: "dummy-project" } } };
    if (name === "expo-router") return { router: {} };
    if (name === "@/context/AppContext") return { useAppContextSelector: (select: any) => select({ switchSweet: () => {} }) };
    if (name === "@/lib/supabase") return { supabase: {} };
    if (name === "@/lib/runtimeDiagnostics") return { reportRuntimeError: (context: string) => calls.errors.push(context) };
    if (name === "@/lib/pushRegistration") return {
      registerPushDevice: async (...args: unknown[]) => { calls.registration.push(args); },
      unregisterPushDevice: async () => { calls.unregister++; if (options.cleanupFailure) throw Error("Offline"); },
    };
    if (name === "expo-notifications") return {
      IosAuthorizationStatus: { PROVISIONAL: 3 },
      setNotificationHandler: () => { calls.handler++; },
      setNotificationChannelAsync: () => { throw Error("Android channel setup must stay disabled"); },
      getPermissionsAsync: async () => { calls.permission++; return { status: granted ? "granted" : options.request ? "undetermined" : "denied", granted, canAskAgain: true }; },
      requestPermissionsAsync: async () => { calls.request++; return { status: "granted", granted: true }; },
      getExpoPushTokenAsync: async () => { calls.token++; return { data: "dummy-push-token" }; },
      getLastNotificationResponseAsync: async () => null,
      addPushTokenListener: listener, addNotificationResponseReceivedListener: listener,
    };
    throw Error(name);
  } });
  exports.PushNotificationManager({ userId: options.userId === undefined ? "dummy-user" : options.userId });
  const cleanup = effect(); await settle();
  return { calls, cleanup, foreground, settle };
}
for (const cleanupFailure of [false, true]) {
  const f = await fixture("android", { cleanupFailure });
  assert.equal(f.calls.handler, 0); assert.equal(f.calls.permission, 0); assert.equal(f.calls.request, 0);
  assert.equal(f.calls.token, 0); assert.equal(f.calls.registration.length, 0); assert.equal(f.calls.listeners, 0);
  assert.equal(f.calls.unregister, 1, "retire a previous Android push installation if one exists");
  assert.equal(f.calls.errors.length, cleanupFailure ? 1 : 0, "cleanup failure must be contained without enabling push");
}
{
  const f = await fixture("android", { userId: null });
  assert.equal(f.calls.unregister, 0); assert.equal(f.calls.permission, 0);
}
{
  const f = await fixture("ios");
  assert.equal(f.calls.handler, 1); assert.equal(f.calls.permission, 1);
  assert.deepEqual(f.calls.registration, [["dummy-user", "dummy-push-token", "ios"]]);
  assert.equal(f.calls.listeners, 3);
  f.foreground("active"); await settle(); assert.equal(f.calls.registration.length, 2, "iOS refresh registration must remain available");
  f.cleanup!(); assert.equal(f.calls.removals, 3);
}
{
  const f = await fixture("ios", { granted: false, request: true });
  assert.equal(f.calls.request, 1); assert.equal(f.calls.registration.length, 1); f.cleanup!();
}
{
  const f = await fixture("ios", { granted: false });
  assert.equal(f.calls.token, 0); assert.equal(f.calls.unregister, 1); f.cleanup!();
}
{
  const f = await fixture("ios", { device: false });
  assert.equal(f.calls.permission, 0); assert.equal(f.calls.registration.length, 0);
}
console.log("Push platform policy passed: Android in-app only with old-installation cleanup, and preserved iOS registration, permissions, refresh and teardown.");
