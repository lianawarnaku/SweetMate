// Run with: node scripts/feedback/test-database.mjs /absolute/path/to/pglite/dist/index.js
// Uses a disposable PostgreSQL WASM database; never touches production data.
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const { PGlite } = await import(process.argv[2] || "@electric-sql/pglite");
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
insert into auth.users values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');`);
await db.exec(
  await readFile(
    new URL(
      "../../supabase/migrations/202610020001_feedback.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
await db.exec(
  await readFile(
    new URL(
      "../../supabase/migrations/202610020003_feedback_unicode_whitespace.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
const user = "11111111-1111-4111-8111-111111111111";
await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`);
const args = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "suggestion",
  "Useful feedback",
  null,
  "1.0",
  "web",
];
const submit = (values) =>
  db.query("select public.submit_feedback($1,$2,$3,$4,$5,$6) id", values);
const first = (await submit(args)).rows[0].id;
assert.equal(
  (await submit(args)).rows[0].id,
  first,
  "network retry must be idempotent",
);
await assert.rejects(
  submit([args[0], "bug", ...args.slice(2)]),
  /Request already used/,
);
for (const query of [
  "select * from public.feedback",
  "update public.feedback set status='closed'",
  "delete from public.feedback",
  `insert into public.feedback(request_id,category,message,user_id) values(gen_random_uuid(),'bug','spoof','22222222-2222-4222-8222-222222222222')`,
  `insert into public.feedback(request_id,category,message,status) values(gen_random_uuid(),'bug','spoof','closed')`,
  `insert into public.feedback(request_id,category,message,created_at) values(gen_random_uuid(),'bug','spoof',now())`,
  `select * from public.claim_feedback_notifications(null)`,
])
  await assert.rejects(db.exec(query), /permission denied/);
for (const patch of [
  { 2: "  \n\t" },
  { 2: "\u00a0\u2003\ufeff" },
  { 2: "a".repeat(1501) },
  { 1: "invalid" },
  { 3: "invalid@" },
]) {
  const values = [...args];
  values[0] = crypto.randomUUID();
  Object.assign(values, patch);
  await assert.rejects(submit(values), /check constraint/);
}
for (let i = 0; i < 4; i++)
  await submit([crypto.randomUUID(), ...args.slice(1)]);
await assert.rejects(
  submit([crypto.randomUUID(), ...args.slice(1)]),
  /rate limit/,
);
assert.equal(
  (await submit(args)).rows[0].id,
  first,
  "retry works after quota reached",
);
await db.exec(
  `set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';`,
);
assert.notEqual(
  (await submit(args)).rows[0].id,
  first,
  "idempotency receipts are scoped to auth user",
);
await db.exec("reset role;");
const rows = (await db.query("select * from public.feedback order by user_id"))
  .rows;
assert.equal(rows.length, 6);
assert.equal(rows[0].user_id, user);
assert.equal(rows[0].status, "new");
await db.exec("set role anon;");
await assert.rejects(submit(args), /permission denied/);
await db.exec("reset role; set role service_role;");
const claimed = await db.query(
  "select * from public.claim_feedback_notifications(null)",
);
assert.equal(claimed.rows.length, 6);
assert.equal(
  (await db.query("select * from public.claim_feedback_notifications(null)"))
    .rows.length,
  0,
  "concurrent worker cannot reclaim leases",
);
await db.exec("reset role;");
await db.exec(
  "update public.feedback set notification_locked_until=now()-interval '1 second'",
);
assert.equal(
  (await db.query("select * from public.claim_feedback_notifications(null)"))
    .rows.length,
  6,
  "crashed worker leases recover",
);
await db.close();
console.log(
  "PASS: migration, authenticated save, validation, identity, privileges, RLS, idempotency, rate limit, notification leases",
);
