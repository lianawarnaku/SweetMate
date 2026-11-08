// Run with: node scripts/chores/test-database.mjs /absolute/path/to/@electric-sql/pglite/dist/index.js
// Executes real migrations in a disposable PostgreSQL WASM database. No remote data.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function runChoreDatabaseTests(db) {
const owner = '11111111-1111-4111-8111-111111111111';
const member = '22222222-2222-4222-8222-222222222222';
const former = '33333333-3333-4333-8333-333333333333';
const other = '44444444-4444-4444-8444-444444444444';
const household = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const secondHousehold = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
const migrate = async (name) => {
  let sql = await readFile(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
  // gen_random_uuid is built into PostgreSQL; this test needs no pgcrypto extension.
  sql = sql.replace('create extension if not exists pgcrypto;', '');
  await db.exec(sql);
};
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
create publication supabase_realtime;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
insert into auth.users values ('${owner}'),('${member}'),('${former}'),('${other}');`);
for (const migration of [
  '202607220001_household_realtime', '202607220002_household_memberships',
  '202607230002_deterministic_chore_foundation', '202607230003_chart_approval_flow',
  '202607260001_multi_sweet_memberships', '202608260001_chores_table',
  '202608260002_household_timezone', '202608260003_shared_owner_check',
  '202608260005_chore_materialization_floor',
]) await migrate(migration);
await db.exec(`insert into public.households(id,name,invite_code,created_by,timezone) values
('${household}','Home','HOME0001','${owner}','America/New_York'),
('${secondHousehold}','Other','HOME0002','${other}','UTC');
insert into public.household_members(household_id,user_id,display_name,role,status) values
('${household}','${owner}','Owner','owner','active'),
('${household}','${member}','Member','member','active'),
('${household}','${former}','Former','owner','left'),
('${secondHousehold}','${other}','Other','owner','active');
insert into public.proposed_charts(household_id,created_by,payload,created_at) values
('${household}','${owner}','{}','2026-01-01'),('${household}','${owner}','{}','2026-01-02');`);
await migrate('202611080001_chore_chart_integrity');
assert.equal(await scalar(`select count(*)::int from public.proposed_charts where status='pending'`), 1);
const login = async (id) => db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${id}';`);
const task = { id: 'kitchen:floor', itemCategory: 'kitchen', item: 'Floor', title: 'Clean kitchen floor', frequency: 'everyThreeDays', timeOfDay: 'night', difficulty: 2 };
const payload = () => ({ version: 2, rotation: 'round-robin', generatedTasks: [task],
  assignments: [{ memberId: owner, taskIds: [task.id], totalLoad: 14 / 3 }, { memberId: member, taskIds: [], totalLoad: 0 }],
  memberLoads: [{ memberId: owner, totalLoad: 14 / 3 }, { memberId: member, totalLoad: 0 }],
  existingLoads: {}, pinnedAssignments: {}, excludedAssignments: {} });
const propose = (plan = payload()) => scalar('select public.replace_proposed_chart($1,$2)', [household, plan]);
const approve = (id) => scalar('select public.approve_proposed_chart($1)', [id]);
const apply = (id, rows) => db.query('select public.apply_approved_chore_chart($1,$2)', [id, JSON.stringify(rows)]);
await login(owner);
await db.query('insert into public.member_task_preferences(household_id,member_id,key,value) values($1,$2,$3,$4)', [household, owner, 'morning', 80]);
await assert.rejects(db.query('insert into public.member_task_preferences(household_id,member_id,key,value) values($1,$2,$3,$4)', [household, member, 'morning', 1]), /row-level security/);
assert.equal((await db.query('insert into public.member_task_preferences(household_id,member_id,key,value) values($1,$2,$3,$4) on conflict(household_id,member_id,key) do update set value=excluded.value returning value', [household, owner, 'morning', 90])).rows[0].value, 90, 'own preference upsert succeeds');
await login(member);
assert.equal((await db.query('update public.member_task_preferences set value=0 where member_id=$1 returning *', [owner])).rows.length, 0);
assert.equal(await scalar('select value from public.member_task_preferences where member_id=$1', [owner]), 90);
await login(former);
await assert.rejects(propose(), /membership/);
await login(other);
await assert.rejects(propose(), /membership/);
await login(owner);
await db.query('select public.seed_item_difficulty($1)', [household]);
assert.equal(await scalar("select count(*)::int from public.item_difficulty where household_id=$1 and category in ('bedroom','laundry')", [household]), 4);
await db.query("update public.item_difficulty set difficulty=5 where household_id=$1 and category='laundry' and item='Dryer'", [household]);
await db.query('select public.seed_item_difficulty($1)', [household]);
assert.equal(await scalar("select difficulty from public.item_difficulty where household_id=$1 and category='laundry' and item='Dryer'", [household]), 5, 'seeding preserves household weights');
for (const sql of [
  `update public.proposed_charts set status='approved'`,
  `delete from public.proposed_charts`,
  `insert into public.proposed_charts(household_id,created_by,payload) values('${household}','${owner}','{}')`,
  `update public.proposed_chart_approvals set approved=true`,
  `insert into public.proposed_chart_approvals(household_id,proposed_chart_id,member_id,approved) select '${household}',id,'${member}',true from public.proposed_charts limit 1`,
]) await assert.rejects(db.exec(sql), /permission denied/);
for (const transform of [
  (p) => p.generatedTasks.push(task),
  (p) => p.assignments[0].taskIds.push(task.id),
  (p) => p.assignments[0].taskIds.splice(0),
  (p) => p.assignments.pop(),
  (p) => p.assignments[0].memberId = former,
  (p) => p.assignments[0].totalLoad = 200,
  (p) => p.generatedTasks[0] = { ...task, frequency: 'everyThreeMonths' },
  (p) => p.generatedTasks[0] = { ...task, difficulty: 7 },
  (p) => p.pinnedAssignments[task.id] = member,
  (p) => p.excludedAssignments[task.id] = [owner],
]) { const plan = payload(); transform(plan); await assert.rejects(propose(plan)); }
let chart = await propose();
assert.equal(await scalar('select count(*)::int from public.proposed_chart_approvals where proposed_chart_id=$1', [chart]), 2, 'inactive members cannot vote');
await assert.rejects(apply(chart, []), /approval is required/);
assert.equal(await approve(chart), 'pending');
await login(member);
await assert.rejects(db.query('select public.force_approve_proposed_chart($1)', [chart]), /active household owner/);
assert.equal(await approve(chart), 'approved');
assert.equal(await approve(chart), 'approved', 'vote retries are harmless');
await login(former);
await assert.rejects(db.query('select public.force_approve_proposed_chart($1)', [chart]), /active household owner/);
await login(owner);
// Sequential retries and overlapping requests must retain the database invariant.
const replacements = await Promise.all([propose(), propose()]);
assert.equal(await scalar(`select count(*)::int from public.proposed_charts where household_id=$1 and status='pending'`, [household]), 1);
assert.equal(await scalar(`select count(*)::int from public.proposed_charts where id=any($1::uuid[]) and status='cancelled'`, [replacements]), 1);
chart = replacements[1];
await approve(chart); await login(member); assert.equal(await approve(chart), 'approved');
await login(owner);
const cutover = await scalar(`select ((now() at time zone timezone)::date+1)::text from public.households where id=$1`, [household]);
const today = await scalar(`select ((now() at time zone timezone)::date)::text from public.households where id=$1`, [household]);
const yesterday = await scalar(`select ((now() at time zone timezone)::date-1)::text from public.households where id=$1`, [household]);
const chore = (overrides = {}) => ({
  id: 'new-anchor', household_id: household, title: task.title, description: null, creator_id: owner, assigned_to: owner,
  assignment_mode: 'round-robin', round_robin_participant_ids: [owner, member], round_robin_all_members: true, round_robin_cursor: 0,
  excluded_participant_ids: [], due_date: `${cutover}T20:00:00Z`, initial_due_date: `${cutover}T20:00:00Z`, next_due_date: null,
  scheduled_date: cutover, initial_scheduled_date: cutover, monthly_anchor_day: null, excluded_occurrence_dates: [],
  materialization_starts_on: cutover, recurrence_ends_on: null, completed: false, completed_at: null, completed_by_user_id: null,
  points: 10, category: 'kitchen', recurring: 'everyThreeDays', recurrence_series_id: 'new-series', occurrence_index: 0,
  next_occurrence_id: null, source_key: task.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  time_of_day: 'night', assignment_locked: false, ...overrides,
});
await db.exec('reset role;');
for (const row of [chore({ id: 'past', recurrence_series_id: 'old-series', completed: true, completed_at: `${today}T12:00:00Z`, completed_by_user_id: owner, scheduled_date: yesterday }),
  chore({ id: 'due-today', recurrence_series_id: 'old-series', scheduled_date: today }),
  chore({ id: 'future-old', recurrence_series_id: 'old-series' }),
  chore({ id: 'manual', source_key: null, recurrence_series_id: null, title: 'Manual task', assignment_locked: true }),
]) await db.query('insert into public.chores select * from jsonb_populate_record(null::public.chores,$1)', [row]);
await login(owner);
for (const patch of [
  { household_id: secondHousehold }, { assigned_to: member }, { title: 'Unapproved title' },
  { recurring: 'daily' }, { points: 999 }, { time_of_day: 'morning' },
  { round_robin_participant_ids: [owner] }, { excluded_participant_ids: [member] },
  { completed: true }, { id: 'past' }, { id: 'manual' }, { materialization_starts_on: today },
]) await assert.rejects(apply(chart, [chore(patch)]));
await assert.rejects(apply(chart, [chore(), chore({ id: 'invalid-row', assigned_to: member })]));
assert.equal(await scalar(`select count(*)::int from public.chores where id='new-anchor'`), 0, 'bad later row rolls the entire transaction back');
await apply(chart, [chore()]);
assert.equal(await scalar(`select count(*)::int from public.chores where id='new-anchor'`), 1);
assert.equal(await scalar(`select count(*)::int from public.chores where id='future-old'`), 0);
assert.equal(await scalar(`select completed from public.chores where id='past'`), true);
assert.equal(await scalar(`select recurrence_ends_on::text from public.chores where id='past'`), cutover);
assert.equal(await scalar(`select count(*)::int from public.chores where id in ('manual','due-today')`), 2);
assert.equal(await scalar('select applied_at is not null from public.proposed_charts where id=$1', [chart]), true);
await apply(chart, [chore({ id: 'retry-duplicate' })]);
assert.equal(await scalar(`select count(*)::int from public.chores where id='retry-duplicate'`), 0, 'chart application is idempotent across clients');
await db.query(`insert into public.item_difficulty(household_id,category,item,difficulty) values ($1,'bedroom','Floor',3),($1,'laundry','Washer',4)`, [household]);
// An offline snapshot cannot clear retirement or revive removed future work.
await db.query(`update public.chores set recurrence_ends_on=null where id='due-today'`);
assert.equal(await scalar(`select recurrence_ends_on::text from public.chores where id='due-today'`), cutover);
await db.query('insert into public.chores select * from jsonb_populate_record(null::public.chores,$1) on conflict(id) do update set recurrence_ends_on=null', [chore({ id: 'future-old', recurrence_series_id: 'old-series' })]);
assert.equal(await scalar(`select count(*)::int from public.chores where id='future-old'`), 0);
await db.query('insert into public.chores select * from jsonb_populate_record(null::public.chores,$1)', [chore({ id: 'offline-completion', recurrence_series_id: 'old-series', completed: true, completed_at: new Date().toISOString(), completed_by_user_id: owner })]);
assert.equal(await scalar(`select completed from public.chores where id='offline-completion'`), true, 'offline completed facts are preserved');
await db.query(`update public.chores set completed=false,completed_at=null,completed_by_user_id=null where id='offline-completion'`);
assert.equal(await scalar(`select completed from public.chores where id='offline-completion'`), false, 'retirement does not block explicitly undoing a completed fact');
await assert.rejects(db.query('delete from public.retired_chore_series'), /permission denied/);
// Initial household setup may continue inserting its initial chores directly.
await db.query('insert into public.chores select * from jsonb_populate_record(null::public.chores,$1)', [chore({ id: 'setup-initial', source_key: 'setup:bedroom', recurrence_series_id: 'setup-series', assignment_mode: 'specific-person', round_robin_participant_ids: [] })]);
assert.equal(await scalar(`select count(*)::int from public.chores where id='setup-initial'`), 1);

// Explicit pins retain an existing manually locked series and its schedule.
const pinnedPlan = payload(); pinnedPlan.pinnedAssignments[task.id] = owner;
chart = await propose(pinnedPlan);
await db.query('select public.force_approve_proposed_chart($1)', [chart]);
const lockedAnchor = chore({ id: 'locked-anchor', assignment_mode: 'specific-person', round_robin_participant_ids: [],
  round_robin_all_members: false, assignment_locked: true, recurrence_series_id: 'locked-series',
  due_date: `${today}T20:00:00Z`, scheduled_date: today, materialization_starts_on: today });
await db.exec('reset role;');
await db.query('insert into public.chores select * from jsonb_populate_record(null::public.chores,$1)', [lockedAnchor]);
await db.query('insert into public.chores select * from jsonb_populate_record(null::public.chores,$1)', [chore({ id: 'locked-future', recurrence_series_id: 'locked-series' })]);
await login(owner);
await assert.rejects(apply(chart, [{ ...lockedAnchor, scheduled_date: cutover }]), /manual assignment changed/);
await apply(chart, [lockedAnchor]);
assert.equal(await scalar(`select scheduled_date::text from public.chores where id='locked-anchor'`), today);
assert.equal(await scalar(`select count(*)::int from public.chores where id='locked-future'`), 1, 'locked recurrence series is preserved');
// An explicitly edited round-robin assignment stays round-robin across rebuilds.
chart = await propose(pinnedPlan); await db.query('select public.force_approve_proposed_chart($1)', [chart]);
await db.exec(`reset role; update public.chores set assignment_mode='round-robin',round_robin_participant_ids=array['${owner}','${member}']::uuid[],round_robin_all_members=true where id='locked-anchor';`);
const lockedRotation = { ...lockedAnchor, assignment_mode: 'round-robin', round_robin_participant_ids: [owner, member], round_robin_all_members: true };
await login(owner); await apply(chart, [lockedRotation]);
assert.equal(await scalar(`select assignment_mode from public.chores where id='locked-anchor'`), 'round-robin');

// A subsequent manual edit invalidates the old proposal rather than losing the edit.
chart = await propose(pinnedPlan); await db.query('select public.force_approve_proposed_chart($1)', [chart]);
await db.exec(`reset role; update public.chores set assigned_to='${member}' where id='locked-anchor';`);
await login(owner);
await assert.rejects(apply(chart, [lockedRotation]), /manual assignment changed/);
assert.equal(await scalar(`select assigned_to::text from public.chores where id='locked-anchor'`), member);

// Older clients omit the new optional metadata columns and retain defaults.
await db.query(`insert into public.chores(id,household_id,title,assigned_to,due_date) values('legacy-client',$1,'Legacy chore',$2,now())`, [household, owner]);
assert.equal(await scalar(`select time_of_day from public.chores where id='legacy-client'`), 'any');
assert.equal(await scalar(`select assignment_locked from public.chores where id='legacy-client'`), false);
// Ended manual locks are not ongoing constraints on the replacement chart.
await db.exec(`reset role; update public.chores set recurrence_ends_on='${today}' where id='locked-anchor';`);
await login(owner); chart = await propose(); await db.query('select public.force_approve_proposed_chart($1)', [chart]);
await apply(chart, [chore({ id: 'after-ended-lock', recurrence_series_id: 'after-ended-lock-series' })]);
assert.equal(await scalar(`select assignment_mode from public.chores where id='after-ended-lock'`), 'round-robin');
assert.equal(await scalar(`select ends_before::text from public.retired_chore_series where recurrence_series_id='locked-series'`), today, 'ended manual series receives a durable original cutoff');

// A membership change cannot silently approve a stale snapshot.
chart = await propose();
await db.exec(`reset role; update public.household_members set status='left' where household_id='${household}' and user_id='${member}';`);
await login(owner); await assert.rejects(approve(chart), /Invalid assignment member|every active member/);
await db.exec('reset role;');
// Every approval transition and materialization takes the same household lock.
for (const signature of ['replace_proposed_chart(uuid,jsonb)', 'approve_proposed_chart(uuid)', 'force_approve_proposed_chart(uuid)', 'cancel_proposed_charts(uuid)', 'apply_approved_chore_chart(uuid,jsonb)']) {
  const sql = await scalar('select pg_get_functiondef($1::regprocedure)', [`public.${signature}`]);
  assert.match(sql, /from public\.households where id = target_household_id for update/);
}
console.log('PASS: real migrations, own preferences/RLS, immutable proposals/votes, complete task/member/load/constraint validation, active voters, replacement uniqueness, owner override, membership staleness, atomic approved application, history preservation, future-series retirement, recurrence/category constraints, idempotency and shared transaction lock contract.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { PGlite } = await import(process.argv[2] || '@electric-sql/pglite');
  const db = new PGlite();
  try { await runChoreDatabaseTests(db); }
  finally { await db.close(); }
  console.log('PGlite serializes connections; use test-concurrency.mjs for true multi-session contention tests.');
}
