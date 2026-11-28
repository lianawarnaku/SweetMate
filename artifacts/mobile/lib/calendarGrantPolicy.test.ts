import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const exports: any = {};
runInNewContext(ts.transpileModule(readFileSync("../../supabase/functions/_shared/calendar.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports, Set, Error, Response, Request, URLSearchParams, AbortSignal, Date, fetch: () => { throw Error("No real Google calls"); } });
const prefix = "https://www.googleapis.com/auth/";
const scopes = (values: string[]) => values.map(s => prefix + s).join(" ");
for (const values of [["calendar"], ["calendar.events"], ["calendar.events.readonly", "calendar.events.owned"]]) assert(exports.permitsCalendarConnection(scopes(values)));
for (const values of [[], ["calendar.events.readonly"], ["calendar.events.owned"], ["tasks.readonly"], ["calendar.events.evil"]]) assert(!exports.permitsCalendarConnection(scopes(values)));
assert(!exports.permitsCalendarConnection(undefined));
const expected = { id: "app-user", identities: [{ provider: "google", identity_data: { sub: "google-user" } }] };
async function attempt(scope: string | undefined, identity = "google-user", body: any = {}) {
  const writes: any[] = [], calls: string[] = [];
  const admin = { from: (table: string) => ({ upsert: async (row: any) => { writes.push({ table, row }); return { error: null }; } }) };
  const service = exports.createCalendarService(admin, { clientId: "fixture-client", clientSecret: "fixture-secret" }, async (url: string) => {
    calls.push(url);
    if (url === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ access_token: "fixture-access", scope }), { status: 200 });
    if (url === "https://www.googleapis.com/userinfo/v2/me") return new Response(JSON.stringify({ id: identity }), { status: 200 });
    throw Error("No unexpected upstream calls");
  });
  let result: any, failure: any;
  try { result = await service.connect(expected, { refreshToken: "fixture-refresh", ...body }); } catch (e) { failure = e; }
  return { result, failure, writes, calls };
}
for (const values of [["calendar.events"], ["calendar"], ["calendar.events.readonly", "calendar.events.owned", "calendar.calendarlist.readonly", "tasks.readonly"]]) {
  const f = await attempt(scopes(values)); assert.equal(f.result.success, true); assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].row.user_id, "app-user"); assert.equal(f.writes[0].row.scope, scopes(values));
}
{
  const f = await attempt(scopes(["tasks.readonly"]), "google-user", { scope: scopes(["calendar.events"]), userId: "another-user" });
  assert.equal(f.failure.code, "GOOGLE_PERMISSION_DENIED"); assert.equal(f.writes.length, 0); assert.equal(f.calls.length, 1);
}
{
  const f = await attempt(scopes(["calendar.events"]), "different-google-user");
  assert.equal(f.failure.code, "GOOGLE_ACCOUNT_MISMATCH"); assert.equal(f.writes.length, 0);
}
const client = readFileSync("lib/googleCalendarConnection.ts", "utf8");
assert(client.includes('"https://www.googleapis.com/auth/calendar.events.readonly"'));
assert(client.includes('"https://www.googleapis.com/auth/calendar.events.owned"'));
assert(!client.includes('"https://www.googleapis.com/auth/calendar.events",'), "new clients do not request all-calendar writes");
console.log("Google grants: narrow/legacy acceptance, partial/forged scopes, identity isolation and trusted token-response storage passed.");
