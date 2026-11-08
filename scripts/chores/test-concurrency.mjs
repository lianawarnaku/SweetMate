// npm install --prefix /tmp/sweetmate-db-tests embedded-postgres pg
// node scripts/chores/test-concurrency.mjs /tmp/sweetmate-db-tests/node_modules
// Starts a disposable PostgreSQL bound only to localhost; never uses Supabase credentials.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runChoreDatabaseTests } from './test-database.mjs';
const modules = process.argv[2];
const { default: EmbeddedPostgres } = await import(modules ? `${modules}/embedded-postgres/dist/index.js` : 'embedded-postgres');
const directory = await mkdtemp(join(tmpdir(), 'sweetmate-chore-postgres-'));
const postgres = new EmbeddedPostgres({ databaseDir: join(directory, 'data'), port: 55481,
  user: 'postgres', password: 'disposable-local-test', persistent: false,
  postgresFlags: ['-c', 'listen_addresses=127.0.0.1', '-c', `unix_socket_directories=${directory}`],
  onLog: () => {}, onError: (message) => { if (!String(message).includes('NOTICE')) console.error(message); } });
const clients = [];
const connect = async (userId) => {
  const client = postgres.getPgClient(); await client.connect(); clients.push(client);
  if (userId) await client.query(`set role authenticated; set request.jwt.claim.sub='${userId}';`);
  return client;
};
try {
  await postgres.initialise(); await postgres.start();
  const admin = await connect();
  await runChoreDatabaseTests({ exec: (sql) => admin.query(sql), query: (sql, params) => admin.query(sql, params) });
  const owner = '11111111-1111-4111-8111-111111111111';
  const member = '22222222-2222-4222-8222-222222222222';
  const household = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await admin.query(`update public.household_members set status='active' where household_id=$1 and user_id=$2`, [household, member]);
  // Exercise the actual production builder/materializer/row mapper against SQL.
  const { buildHouseholdChart, materializeApprovedChart, withAssignmentRequest } = await import('../../artifacts/mobile/lib/choreChart.ts');
  const { choreToRow, rowToChore } = await import('../../artifacts/mobile/lib/choreRow.ts');
  const members = [{ id: owner }, { id: member }];
  const now = new Date(); const timezone = 'America/New_York';
  const generatedTasks = [
    { id: 'integration:bedroom', itemCategory: 'bedroom', item: 'Carpet', title: 'Vacuum bedroom', frequency: 'weekly', timeOfDay: 'morning', difficulty: 3 },
    { id: 'integration:laundry', itemCategory: 'laundry', item: 'Washing Machine', title: 'Clean washer', frequency: 'biweekly', timeOfDay: 'night', difficulty: 4 },
    { id: 'integration:custom', itemCategory: 'other', item: 'Desk', title: 'Wipe desk', frequency: 'everyThreeDays', timeOfDay: 'any', difficulty: 1 },
    { id: 'integration:monthly', itemCategory: 'kitchen', item: 'Stove', title: 'Deep clean stove', frequency: 'monthly', timeOfDay: 'night', difficulty: 4 },
    { id: 'integration:ended', itemCategory: 'other', item: 'Pantry', title: 'Reset pantry', frequency: 'weekly', timeOfDay: 'any', difficulty: 2 },
    { id: 'integration:ongoing', itemCategory: 'kitchen', item: 'Coffee Machine', title: 'Clean coffee machine', frequency: 'weekly', timeOfDay: 'night', difficulty: 3 },
  ];
  const localToday = (await admin.query('select ((now() at time zone timezone)::date)::text local_day from public.households where id=$1', [household])).rows[0].local_day;
  const endedLock = { id: 'integration-ended-manual', householdId: household, title: 'Old manual pantry', assignedTo: owner,
    assignmentMode: 'specific-person', assignmentLocked: true, dueDate: `${localToday}T12:00:00Z`, scheduledDate: localToday,
    completed: false, points: 10, category: 'other', recurring: 'monthly', recurrenceSeriesId: 'integration-ended-series',
    recurrenceEndsOn: localToday, sourceKey: 'integration:ended' };
  await admin.query('insert into public.chores select * from jsonb_populate_record(null::public.chores,$1)', [choreToRow(endedLock)]);
  const ongoingLock = { ...endedLock, id: 'integration-ongoing-manual', title: 'Manual coffee machine', sourceKey: 'integration:ongoing',
    category: 'kitchen', recurring: 'biweekly', recurrenceSeriesId: 'integration-ongoing-series', recurrenceEndsOn: undefined,
    assignmentMode: 'round-robin', roundRobinParticipantIds: [owner, member], roundRobinAllMembers: true, roundRobinCursor: 0 };
  await admin.query('insert into public.chores select * from jsonb_populate_record(null::public.chores,$1)', [choreToRow(ongoingLock)]);
  // PostgREST returns JSON date strings, while node-postgres otherwise returns Date objects.
  const chores = (await admin.query('select to_jsonb(c) data from public.chores c')).rows.map((row) => rowToChore(row.data));
  const integratedPlan = buildHouseholdChart({ tasks: generatedTasks, members, preferences: [{ householdId: household, memberId: owner, key: 'morning', value: 100 }],
    chores, now, timezone, householdId: household, previous: { pinnedAssignments: { 'integration:bedroom': owner }, excludedAssignments: { 'integration:laundry': [owner] } } });
  assert.equal(integratedPlan.pinnedAssignments['integration:ended'], undefined, 'ended manual lock cannot pin the next chart');
  assert.equal(integratedPlan.generatedTasks.find((task) => task.id === 'integration:ended').frequency, 'weekly', 'ended manual cadence does not override next chart');
  assert.equal(integratedPlan.pinnedAssignments['integration:ongoing'], owner, 'ongoing manual owner remains pinned');
  assert.equal(integratedPlan.generatedTasks.find((task) => task.id === 'integration:ongoing').frequency, 'biweekly', 'ongoing manual cadence survives rebuild');
  integratedPlan.customTasks = [{ id: 'integration:custom', item: 'Desk', title: 'Wipe desk', frequency: 'everyThreeDays', timeOfDay: 'any', difficulty: 1 }];
  const initialUser = await connect(owner); const votingUser = await connect(member);
  const integratedChart = (await initialUser.query('select public.replace_proposed_chart($1,$2) id', [household, integratedPlan])).rows[0].id;
  await initialUser.query('select public.approve_proposed_chart($1)', [integratedChart]);
  await votingUser.query('select public.approve_proposed_chart($1)', [integratedChart]);
  const integratedRows = materializeApprovedChart({ payload: integratedPlan, chores, members, householdId: household, chartId: integratedChart, creatorId: owner, now, timezone }).map(choreToRow);
  assert.equal(integratedRows.find((row) => row.source_key === 'integration:ended').assignment_mode, 'round-robin');
  assert.equal(integratedRows.find((row) => row.source_key === 'integration:ongoing').id, ongoingLock.id);
  assert.equal(integratedRows.find((row) => row.source_key === 'integration:ongoing').assignment_mode, 'round-robin');
  await initialUser.query('select public.apply_approved_chore_chart($1,$2)', [integratedChart, JSON.stringify(integratedRows)]);
  assert.equal((await admin.query('select count(*)::int count from public.chores where id=any($1::text[])', [integratedRows.map((row) => row.id)])).rows[0].count, generatedTasks.length);
  const pinned = (await admin.query('select assignment_mode,assignment_locked from public.chores where source_key=$1', ['integration:bedroom'])).rows[0];
  assert.equal(pinned.assignment_mode, 'specific-person'); assert.equal(pinned.assignment_locked, false);
  assert.equal((await admin.query('select category from public.chores where source_key=$1', ['integration:laundry'])).rows[0].category, 'laundry');
  console.log('PASS: production builder → RPC proposal → member votes → production materializer/row mapper → atomic normalized apply, with custom metadata, category mapping, cumulative pins/exclusions, and baseline load.');

  // A generated Always rule must remain changeable to Never on a later chart.
  const originalBedroom = integratedRows.find((row) => row.source_key === 'integration:bedroom');
  const localYesterday = (await admin.query('select ((now() at time zone timezone)::date-1)::text local_day from public.households where id=$1', [household])).rows[0].local_day;
  for (const record of [
    { ...originalBedroom, id: 'integration-prior-due', due_date: `${localToday}T12:00:00Z`, scheduled_date: localToday, occurrence_index: 1 },
    { ...originalBedroom, id: 'integration-prior-completed', due_date: `${localYesterday}T12:00:00Z`, scheduled_date: localYesterday,
      completed: true, completed_at: new Date().toISOString(), completed_by_user_id: owner, occurrence_index: 0 },
  ]) await admin.query('insert into public.chores select * from jsonb_populate_record(null::public.chores,$1)', [record]);
  const latestChores = (await admin.query('select to_jsonb(c) data from public.chores c')).rows.map((row) => rowToChore(row.data));
  const neverRequest = withAssignmentRequest(integratedPlan, 'integration:bedroom', owner, 'never');
  const neverPlan = buildHouseholdChart({ tasks: generatedTasks, members, preferences: [], chores: latestChores, now, timezone,
    householdId: household, previous: neverRequest });
  assert.equal(neverPlan.pinnedAssignments['integration:bedroom'], undefined);
  assert.deepEqual(neverPlan.excludedAssignments['integration:bedroom'], [owner]);
  const neverChart = (await initialUser.query('select public.replace_proposed_chart($1,$2) id', [household, neverPlan])).rows[0].id;
  await initialUser.query('select public.approve_proposed_chart($1)', [neverChart]);
  await votingUser.query('select public.approve_proposed_chart($1)', [neverChart]);
  const neverRows = materializeApprovedChart({ payload: neverPlan, chores: latestChores, members, householdId: household,
    chartId: neverChart, creatorId: owner, now, timezone }).map(choreToRow);
  const nextBedroom = neverRows.find((row) => row.source_key === 'integration:bedroom');
  assert.equal(nextBedroom.assigned_to, member); assert.equal(nextBedroom.assignment_mode, 'round-robin');
  assert.deepEqual(nextBedroom.round_robin_participant_ids, [member]);
  await initialUser.query('select public.apply_approved_chore_chart($1,$2)', [neverChart, JSON.stringify(neverRows)]);
  assert.equal((await admin.query('select count(*)::int count from public.chores where id=$1', [originalBedroom.id])).rows[0].count, 0, 'old Always future anchor is replaced');
  const history = (await admin.query("select id,assigned_to::text,completed from public.chores where id in ('integration-prior-due','integration-prior-completed')")).rows;
  assert.equal(history.length, 2); assert.ok(history.every((row) => row.assigned_to === owner));
  assert.equal(history.find((row) => row.id === 'integration-prior-completed').completed, true);
  console.log('PASS: full Always → Never request/rebuild/approval/apply moves future work to eligible roommates and preserves prior due work and completed history.');

  const first = await connect(owner); const second = await connect(member);
  const payload = { version: 2, rotation: 'round-robin', generatedTasks: [], existingLoads: {}, pinnedAssignments: {}, excludedAssignments: {},
    assignments: [{ memberId: owner, taskIds: [], totalLoad: 0 }, { memberId: member, taskIds: [], totalLoad: 0 }] };
  const propose = async (client) => (await client.query('select public.replace_proposed_chart($1,$2) id', [household, payload])).rows[0].id;
  let chart = await propose(first);
  // Hold the first vote uncommitted while the second voter attempts its RPC.
  await first.query('begin');
  assert.equal((await first.query('select public.approve_proposed_chart($1) status', [chart])).rows[0].status, 'pending');
  let secondFinished = false;
  const finalVote = second.query('select public.approve_proposed_chart($1) status', [chart]).then((result) => { secondFinished = true; return result; });
  await first.query('select pg_sleep(0.15)');
  assert.equal(secondFinished, false, 'second voter must wait for the first household transaction');
  await first.query('commit');
  assert.equal((await finalVote).rows[0].status, 'approved');
  assert.equal((await admin.query('select status from public.proposed_charts where id=$1', [chart])).rows[0].status, 'approved');
  // Two replacements cannot both remain pending, even while the first is uncommitted.
  await first.query('begin'); const older = await propose(first);
  let replaced = false;
  const replacement = propose(second).then((id) => { replaced = true; return id; });
  await first.query('select pg_sleep(0.15)'); assert.equal(replaced, false);
  await first.query('commit'); const newer = await replacement;
  const statuses = (await admin.query('select id,status from public.proposed_charts where id=any($1::uuid[])', [[older, newer]])).rows;
  assert.equal(statuses.find((p) => p.id === older).status, 'cancelled');
  assert.equal(statuses.find((p) => p.id === newer).status, 'pending');
  // Applying the same approved chart concurrently is a harmless replay.
  chart = newer;
  await first.query('select public.approve_proposed_chart($1)', [chart]);
  await second.query('select public.approve_proposed_chart($1)', [chart]);
  await first.query('begin'); await first.query('select public.apply_approved_chore_chart($1,$2)', [chart, '[]']);
  let applied = false;
  const secondApply = second.query('select public.apply_approved_chore_chart($1,$2)', [chart, '[]']).then(() => { applied = true; });
  await first.query('select pg_sleep(0.15)'); assert.equal(applied, false);
  await first.query('commit'); await secondApply;
  assert.equal((await admin.query('select applied_at is not null applied from public.proposed_charts where id=$1', [chart])).rows[0].applied, true);
  console.log('PASS: native PostgreSQL multi-session final votes, concurrent replacements, lock contention, and once-only chart application.');
} finally {
  await Promise.allSettled(clients.map((client) => client.end()));
  await postgres.stop();
  await rm(directory, { recursive: true, force: true });
}
