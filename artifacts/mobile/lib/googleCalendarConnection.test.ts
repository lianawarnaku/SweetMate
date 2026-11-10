import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const connection = readFileSync(resolve(process.cwd(), "lib/googleCalendarConnection.ts"), "utf8");
const externalTasks = readFileSync(resolve(process.cwd(), "lib/externalTasks.ts"), "utf8");
const repoRoot = resolve(process.cwd(), "..", "..");
const calendarRoute = readFileSync(
  resolve(repoRoot, "artifacts/api-server/src/routes/calendar.ts"),
  "utf8",
);
const connectionRoute = readFileSync(
  resolve(repoRoot, "artifacts/api-server/src/routes/googleCalendarConnection.ts"),
  "utf8",
);
const migration = readFileSync(
  resolve(repoRoot, "supabase/migrations/202608260004_google_calendar_connections.sql"),
  "utf8",
);

assert(
  connection.includes('access_type: "offline"') &&
    connection.includes('prompt: "consent"') &&
    connection.includes("calendar.events"),
  "connecting must request offline access and the calendar scope, forcing consent so a refresh token is actually returned",
);
assert(
  connection.includes("session?.provider_refresh_token"),
  "the mobile app must read Supabase's own provider_refresh_token rather than talking to Google directly",
);

assert(
  externalTasks.includes("export function apiBaseUrl") &&
    readFileSync(resolve(process.cwd(), "lib/calendarTransport.ts"), "utf8").includes("Authorization: `Bearer ${data.session.access_token}`"),
  "add-chore calendar export must authenticate as the current user, not call the server anonymously",
);

assert(
  calendarRoute.includes('router.post("/calendar/add-chore", requireUser') &&
    calendarRoute.includes("userCalendarRequest("),
  "add-chore must run behind requireUser and act on the caller's own calendar",
);
assert(
  connectionRoute.includes('router.post("/calendar/connect", requireUser') &&
    connectionRoute.includes('router.post("/calendar/disconnect", requireUser'),
  "connect and disconnect must both require an authenticated caller",
);

assert(
  migration.includes("enable row level security") &&
    !migration.includes("create policy"),
  "google_calendar_connections must have RLS enabled with zero policies granted to client roles — only the service-role key may read refresh tokens",
);

console.log("google calendar connection tests passed");

// Execute the actual OAuth callbacks, including native implicit-token redirects.
import ts from "typescript";
import { runInNewContext } from "node:vm";
import strict from "node:assert/strict";
const readCallback = (url: string, key: string) => {
  const parsed = new URL(url);
  return parsed.searchParams.get(key) ?? new URLSearchParams(parsed.hash.slice(1)).get(key);
};
async function fixture(flow: string) {
  const posts: any[] = [];
  const sessions: any[] = [];
  const original = { user: { id: "me" }, access_token: "original-access", refresh_token: "original-refresh" };
  const returned = { user: { id: flow === "wrong-account" ? "other" : "me" }, provider_refresh_token: flow === "code" ? "google-refresh" : undefined };
  const oauth = { type: flow === "cancel" ? "cancel" : "success", url: flow === "denied"
    ? "sweetmate://auth/callback#error=access_denied"
    : flow === "code" || flow === "exchange-error" ? "sweetmate://auth/callback?code=test-code"
    : "sweetmate://auth/callback#access_token=app-access&refresh_token=app-refresh" + (flow === "missing-provider" ? "" : "&provider_refresh_token=google-refresh") };
  const exports: any = {};
  const imports: Record<string, unknown> = {
    "expo-linking": { createURL: () => "sweetmate://auth/callback" },
    "expo-web-browser": { openAuthSessionAsync: async () => oauth },
    "./supabase": { supabase: { auth: {
      getSession: async () => ({ data: { session: original } }),
      signInWithOAuth: async () => ({ data: { url: "https://accounts.invalid" }, error: null }),
      exchangeCodeForSession: async () => ({ data: { session: returned }, error: flow === "exchange-error" ? new Error("failed") : null }),
      setSession: async (value: unknown) => { sessions.push(value); return { data: { session: returned }, error: null }; },
    } } },
    "./oauthCallback": { authCallbackValue: readCallback },
    "./calendarTransport": { calendarFetch: async (path: string, init: any) => { posts.push({ path, init }); return { ok: flow !== "server-error", json: async () => ({ error: "server-error" }) }; } },
  };
  const js = ts.transpileModule(connection, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(js, { exports, require: (name: string) => { strict(name in imports); return imports[name]; } });
  let error: any;
  try { await exports.connectGoogleCalendar(); } catch (cause) { error = cause; }
  return { posts, sessions, error };
}
for (const flow of ["code", "implicit"]) {
  const result = await fixture(flow);
  strict.equal(result.error, undefined);
  strict.equal(JSON.parse(result.posts[0].init.body).refreshToken, "google-refresh");
}
for (const flow of ["cancel", "denied", "exchange-error", "missing-provider", "wrong-account"]) {
  const result = await fixture(flow);
  strict(result.error, `${flow} must fail without saving a connection`);
  strict.equal(result.posts.length, 0);
  if (flow === "wrong-account") strict.equal(result.sessions.at(-1).access_token, "original-access");
}
strict((await fixture("server-error")).error);
console.log("Google Calendar native OAuth runtime tests passed");
