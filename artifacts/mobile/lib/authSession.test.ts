import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const compile = (path: string) => ts.transpileModule(readFileSync(resolve(process.cwd(), path), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: false } }).outputText;

// Verify the actual singleton client uses persistent storage and token renewal.
const storage = { marker: "device-storage" }, client = { marker: "singleton" };
let clientOptions: any, clientCreations = 0;
const clientModule: any = {};
runInNewContext(compile("lib/supabase.ts"), { exports: clientModule, process: { env: { EXPO_PUBLIC_SUPABASE_URL: "https://test.invalid", EXPO_PUBLIC_SUPABASE_ANON_KEY: "public-test-key" } }, require: (name: string) => {
  if (name === "./chorePolicyFetch") return { createChorePolicyFetch: () => () => {} };
  if (name === "@react-native-async-storage/async-storage") return { default: storage };
  if (name === "react-native-url-polyfill/auto") return {};
  if (name === "@supabase/supabase-js") return { createClient: (_url: string, _key: string, options: any) => { clientCreations++; clientOptions = options; return client; } };
  throw new Error(name);
} });
assert.equal(clientCreations, 1); assert.equal(clientModule.supabase, client);
assert.equal(clientOptions.auth.storage, storage);
assert.equal(clientOptions.auth.persistSession, true);
assert.equal(clientOptions.auth.autoRefreshToken, true);
assert.equal(clientOptions.auth.detectSessionInUrl, false, "native callbacks are explicitly exchanged by the app");

async function fixture(initial: any) {
  const state: any[] = [], effects: (() => (() => void))[] = [];
  let index = 0, mounted = false, listener: any, unsubscribed = false, authCalls = 0;
  const exports: any = {};
  runInNewContext(compile("hooks/useSupabaseSession.ts"), { exports, process: { env: {} }, require: (name: string) => {
    if (name === "react") return {
      useState: (value: any) => { const i = index++; if (!(i in state)) state[i] = value; return [state[i], (next: any) => { state[i] = next; }]; },
      useEffect: (effect: any) => { if (!mounted) effects.push(effect); },
    };
    if (name === "@/lib/runtimeDiagnostics") return { reportSupabaseError: () => {} };
    if (name === "@/lib/supabase") return { supabase: { auth: {
      getSession: async () => { authCalls++; return { data: { session: initial }, error: null }; },
      onAuthStateChange: (fn: any) => { listener = fn; return { data: { subscription: { unsubscribe: () => { unsubscribed = true; } } } }; },
    } } };
    throw new Error(name);
  } });
  const render = () => { index = 0; return exports.useSupabaseSession(); };
  const before = render(); mounted = true; const cleanups = effects.map(effect => effect());
  for (let i = 0; i < 8; i++) await Promise.resolve();
  return { before, render, emit: (event: string, session: any) => listener(event, session), cleanup: () => cleanups.forEach(fn => fn()), unsubscribed: () => unsubscribed, calls: () => authCalls };
}
let f = await fixture(null);
assert.equal(f.before.loading, true); assert.equal(f.render().loading, false); assert.equal(f.render().session, null);
f.cleanup(); assert(f.unsubscribed());
for (const provider of ["apple", "google"]) {
  const saved = { user: { id: `${provider}-user`, identities: [{ provider }] }, access_token: "saved", refresh_token: "refresh" };
  f = await fixture(saved);
  assert.equal(f.render().session, saved, `${provider} returning user must restore the saved session`);
  const refreshed = { ...saved, access_token: "renewed" };
  f.emit("TOKEN_REFRESHED", refreshed); assert.equal(f.render().session, refreshed);
  f.emit("SIGNED_OUT", null); assert.equal(f.render().session, null);
  f.emit("SIGNED_IN", saved); assert.equal(f.render().session, saved);
  assert.equal(f.calls(), 1, "session events must not trigger duplicate restore requests");
  f.cleanup(); assert(f.unsubscribed());
}
console.log("Auth session orchestration passed: persistent singleton configuration, fresh session, Apple/Google restore, refresh/sign-out events and subscription cleanup.");
