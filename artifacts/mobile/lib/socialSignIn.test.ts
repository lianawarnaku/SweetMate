import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { authCallbackValue } from "./oauthCallback.ts";

// Run the real SignInScreen OAuth callback, replacing only provider/session
// boundaries. This verifies client logic, not live Apple/Google consent.
const source = readFileSync(resolve(process.cwd(), "components/SignInScreen.tsx"), "utf8");
const parsed = ts.createSourceFile("SignInScreen.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback: ts.Expression | undefined;
function find(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "signInWithSocialProvider") callback = node.initializer;
  ts.forEachChild(node, find);
}
find(parsed);
assert(callback);
const code = ts.transpileModule(`exports.run = ${callback.getText(parsed)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function fixture(flow: string, gated = false) {
  const calls: any[] = [], errors: string[] = [], busy: unknown[] = [], analytics: any[] = [];
  let successes = 0;
  let finishBrowser: ((result: any) => void) | undefined;
  const result = {
    type: flow === "cancel" ? "cancel" : flow === "dismiss" ? "dismiss" : "success",
    url: flow === "denied" ? "sweetmate://auth/callback#error=access_denied"
      : flow === "missing-tokens" ? "sweetmate://auth/callback#access_token=access"
      : flow === "implicit" || flow === "session-error" ? "sweetmate://auth/callback#access_token=access&refresh_token=refresh"
      : "sweetmate://auth/callback?code=authorization-code",
  };
  const session = flow === "null-session" ? null : { user: { id: "test-user" } };
  const exports: any = {};
  runInNewContext(code, { exports, Error,
    privacyChoiceReady: true, loading: false, socialLoading: null, socialInFlightRef: { current: false }, mode: "signin",
    setSocialLoading: (value: unknown) => busy.push(value), setError: (value: any) => { if (value) errors.push(value); }, setInfo: () => {},
    beginAnalyticsAuth: () => "attempt", recordAnalyticsAuthSucceeded: async (...args: any[]) => analytics.push(args),
    ExpoLinking: { createURL: () => "sweetmate://auth/callback" },
    WebBrowser: { openAuthSessionAsync: async (...args: any[]) => { calls.push(["browser", ...args]); return gated ? new Promise(done => { finishBrowser = done; }) : result; } },
    supabase: { auth: {
      signInWithOAuth: async (value: any) => { calls.push(["oauth", value]); return { data: { url: flow === "missing-url" ? null : "https://provider.invalid/authorize" }, error: flow === "start-error" ? new Error("Provider unavailable") : null }; },
      exchangeCodeForSession: async (value: any) => { calls.push(["code", value]); return { data: { session }, error: flow === "exchange-error" ? new Error("Exchange failed") : null }; },
      setSession: async (value: any) => { calls.push(["session", value]); return { data: { session }, error: flow === "session-error" ? new Error("Session failed") : null }; },
    } },
    authCallbackValue, Haptics: { NotificationFeedbackType: { Success: "success" }, notificationAsync: () => { successes++; } }, hapticError: () => {}, reportRuntimeError: () => {},
  });
  return { run: exports.run, calls, errors, busy, analytics, successes: () => successes, release: () => finishBrowser?.(result) };
}
for (const provider of ["apple", "google"]) {
  for (const flow of ["code", "implicit"]) {
    const f = fixture(flow); await f.run(provider);
    assert.equal(f.errors.length, 0); assert.equal(f.successes(), 1); assert.equal(f.analytics.length, 1);
    assert.equal(f.calls[0][1].provider, provider);
    assert.equal(f.calls[0][1].options.redirectTo, "sweetmate://auth/callback");
    assert.equal(f.calls[0][1].options.skipBrowserRedirect, true);
    assert.equal(f.calls[0][1].options.scopes, undefined, "sign-in must not add Calendar scopes");
    assert.equal(f.busy.at(-1), null);
  }
  for (const flow of ["cancel", "dismiss", "denied", "missing-tokens", "start-error", "missing-url", "exchange-error", "session-error", "null-session"]) {
    const f = fixture(flow); await f.run(provider);
    assert.equal(f.successes(), 0, `${provider}/${flow} must not report success`);
    assert.equal(f.analytics.length, 0); assert.equal(f.busy.at(-1), null);
    if (["cancel", "dismiss"].includes(flow)) { assert.equal(f.errors.length, 0); assert.equal(f.calls.length, 2); }
    else assert.equal(f.errors.length, 1, `${provider}/${flow} must show a recoverable error`);
  }
  const f = fixture("code", true);
  const first = f.run(provider);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await f.run(provider);
  assert.equal(f.calls.filter((call: any[]) => call[0] === "oauth").length, 1, "repeated taps must not launch competing sign-in sessions");
  f.release(); await first; assert.equal(f.successes(), 1);
}
console.log("Apple/Google sign-in callback tests passed: code/token flows, cancellation, denied/invalid/missing sessions, errors, scope separation and repeated taps.");
