// Runs the real SQL migration in an isolated PostgreSQL WASM database.
// Install @electric-sql/pglite in a temporary directory and set PGLITE_MODULE
// to its dist/index.js path, or install it in your local test environment.
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { fileURLToPath } from "node:url";
const { PGlite } = await import(
  process.env.PGLITE_MODULE ?? "@electric-sql/pglite"
);
const root = fileURLToPath(new URL("../../", import.meta.url));
const db = new PGlite();
await db.exec(`create schema auth; create table auth.users(id uuid primary key);
create role anon;create role authenticated;
create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
create table public.household_states(household_id uuid,state jsonb);
create table public.households(id uuid primary key,timezone text not null default 'America/New_York');
create table public.household_members(household_id uuid,user_id uuid,status text default 'active');
create table public.proposed_charts(id uuid,household_id uuid,status text,payload jsonb,applied_at timestamptz,created_at timestamptz,created_by uuid);`);
const initial = readFileSync(
  root + "/supabase/migrations/202608260001_chores_table.sql",
  "utf8",
);
await db.exec(
  initial.slice(
    initial.indexOf("create table public.chores"),
    initial.indexOf("-- The real constraint"),
  ),
);
await db.exec(`alter table public.chores add column time_of_day text default 'any',add column assignment_locked boolean default false;
alter table public.chores add column materialization_starts_on date;`);
const sweet = "00000000-0000-0000-0000-000000000001",
  otherSweet = "00000000-0000-0000-0000-000000000002";
const x = "10000000-0000-0000-0000-000000000001",
  y = "10000000-0000-0000-0000-000000000002";
await db.query("insert into public.households(id) values ($1),($2)", [
  sweet,
  otherSweet,
]);
await db.query("insert into auth.users values ($1),($2)", [x, y]);
await db.query(
  "insert into public.household_members(household_id,user_id) values ($1,$2),($1,$3)",
  [sweet, x, y],
);
async function add(
  id,
  date,
  owner = x,
  series = "trash",
  house = sweet,
  source = null,
  done = false,
) {
  await db.query(
    `insert into public.chores(id,household_id,title,assigned_to,due_date,initial_due_date,scheduled_date,initial_scheduled_date,recurrence_series_id,recurring,source_key,completed,completed_at,created_at)
 values($1,$2,'Trash',$3,$4::date+interval '17 hours',$4::date+interval '17 hours',$4,$4,$5,'weekly',$6,$7,case when $7 then $4::date+interval '18 hours' else null end,$4::date)`,
    [id, house, owner, date, series, source, done],
  );
}
await add("old-x", "2026-10-01");
await add("later-y", "2026-10-08", y);
await add("done", "2026-09-24", y, "trash", sweet, null, true);
await add("source-weekly", "2026-10-01", x, "chart-1", sweet, "kitchen-trash");
await add("source-monthly", "2026-10-08", y, "chart-2", sweet, "kitchen-trash");
await db.exec(
  "update public.chores set recurring='monthly' where id='source-monthly'",
);
await add("legacy-root", "2026-10-01", x, null);
await add("legacy-child", "2026-10-08", y, null);
await db.exec(
  "update public.chores set next_occurrence_id='legacy-child' where id='legacy-root'",
);
await db.exec(
  readFileSync(
    root + "/supabase/migrations/202611100003_single_chore_obligation.sql",
    "utf8",
  ),
);
const get = async (id) =>
  (await db.query("select * from public.chores where id=$1", [id])).rows[0];
assert.equal((await get("old-x")).skipped_at, null);
assert((await get("later-y")).skipped_at);
assert.equal((await get("old-x")).assigned_to, x);
assert.equal((await get("done")).completed, true);
assert.equal(
  (await get("done")).completed_at.toISOString(),
  "2026-09-24T18:00:00.000Z",
);
assert.equal(
  (await get("source-weekly")).chore_definition.recurring,
  "monthly",
);
assert.equal((await get("source-weekly")).skipped_at, null);
assert((await get("source-monthly")).skipped_at);
await add("next-turn", "2026-10-15", y);
assert(
  (await get("next-turn")).skipped_at,
  "late materialization must skip new debt",
);
await db.query(
  "update public.chores set completed=true,completed_at='2026-11-16T15:00:00Z',completed_by_user_id=$1 where id=$2",
  [y, "old-x"],
);
assert.equal((await get("old-x")).assigned_to, x);
assert.equal((await get("old-x")).completed_by_user_id, y);
await db.exec(
  "update public.chores set skipped_at=null,skipped_reason=null,completed=true where id='later-y'",
);
assert.equal((await get("later-y")).completed, false);
assert((await get("later-y")).skipped_at, "skipped turns are permanent");
await add("stale-missed", "2026-10-22", y);
assert(
  (await get("stale-missed")).skipped_at,
  "completion must prevent stale materializers from restoring missed dates",
);
await add("next-open", "2026-11-22", y);
assert.equal((await get("next-open")).skipped_at, null);
await db.exec(
  "update public.chores set completed=false,completed_at=null where id='old-x'",
);
assert.equal((await get("old-x")).skipped_at, null);
assert((await get("next-open")).skipped_at, "undo retains one obligation");
await db.query(
  "update public.household_members set status='left' where household_id=$1 and user_id=$2",
  [sweet, x],
);
assert.equal((await get("old-x")).assigned_to, null);
assert.equal((await get("old-x")).assignment_mode, "unassigned");
await add("separate", "2026-11-10", y, "different-work");
assert.equal((await get("separate")).skipped_at, null, "title is not identity");
await add("other-house", "2026-11-10", y, "trash", otherSweet);
assert.equal((await get("other-house")).skipped_at, null);
await db.query(
  "update public.household_members set status='active' where household_id=$1 and user_id=$2",
  [sweet, x],
);
await db.exec(
  "update public.chores set completed=true,completed_at='2026-11-23T15:00:00Z' where id='old-x'",
);
await Promise.all([
  add("racer-1", "2026-11-29", x),
  add("racer-2", "2026-11-29", y),
]);
const open = await db.query(
  "select id from public.chores where household_id=$1 and chore_definition_id=$2 and not completed and skipped_at is null",
  [sweet, "series:trash"],
);
assert.equal(open.rows.length, 1);
assert.equal(
  (await get("legacy-root")).chore_definition_id,
  (await get("legacy-child")).chore_definition_id,
);
assert((await get("legacy-child")).skipped_at);
// Exercise the real approved-chart RPC with auth/payload validation stubbed;
// this test targets row persistence, retirement and obligation preservation.
await db.exec(`create or replace function auth.uid() returns uuid language sql as $$select '${y}'::uuid$$;
create function public.is_household_member(uuid) returns boolean language sql as $$select true$$;
create function public.validate_chore_chart_payload(uuid,jsonb) returns void language plpgsql as $$begin return;end$$;
create table public.retired_chore_series(household_id uuid,recurrence_series_id text,ends_before date,retired_by_chart_id uuid,primary key(household_id,recurrence_series_id));`);
await db.query("select set_config('request.headers',$1,false)", [JSON.stringify({"x-sweetmate-chore-policy":"single-obligation-v1"})]);
const chart = "20000000-0000-0000-0000-000000000001";
const cutover = (
  await db.query(
    "select ((now() at time zone 'America/New_York')::date+1)::text as date",
  )
).rows[0].date;
const payload = {
  generatedTasks: [
    {
      id: "kitchen-trash",
      title: "Trash",
      frequency: "daily",
      timeOfDay: "any",
      itemCategory: "kitchen",
      difficulty: 2,
    },
  ],
  assignments: [{ memberId: y, taskIds: ["kitchen-trash"] }],
  excludedAssignments: {},
  pinnedAssignments: {},
};
await db.query(
  "insert into public.proposed_charts(id,household_id,status,payload,created_at,created_by) values($1,$2,'approved',$3,now(),$4)",
  [chart, sweet, payload, y],
);
const chartRow = {
  ...(await get("source-weekly")),
  id: "new-chart",
  assigned_to: y,
  assignment_mode: "round-robin",
  round_robin_participant_ids: [x, y],
  round_robin_cursor: 1,
  round_robin_all_members: true,
  category: "kitchen",
  points: 10,
  recurring: "daily",
  scheduled_date: cutover,
  initial_scheduled_date: cutover,
  due_date: cutover + "T17:00:00Z",
  initial_due_date: cutover + "T17:00:00Z",
  materialization_starts_on: cutover,
  recurrence_series_id: "new-chart",
  recurrence_ends_on: null,
  assignment_locked: false,
  skipped_at: null,
  skipped_reason: null,
  chore_definition: {
    ...(await get("source-weekly")).chore_definition,
    seriesId: "new-chart",
    recurring: "daily",
    anchorDate: cutover,
    anchorDueDate: cutover + "T17:00:00Z",
    updatedAt: "2099-01-01T00:00:00.000Z",
  },
};
await db.query("select public.apply_approved_chore_chart($1,$2)", [
  chart,
  [chartRow],
]);
assert.equal(
  (await get("source-weekly")).skipped_at,
  null,
  "chart rebuild must retain the oldest obligation",
);
assert(
  (await get("new-chart")).skipped_at,
  "new chart must not assign another person while the chore is owed",
);
assert.equal(
  (await get("new-chart")).chore_definition.recurring,
  "daily",
  "approved chart must persist its canonical schedule",
);
await db.close();
console.log("PostgreSQL chore migration and enforcement regressions passed");
