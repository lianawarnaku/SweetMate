// Real PostgreSQL sessions against the existing local Supabase stack only.
// node scripts/reliability/test-local-database.mjs /absolute/path/to/node_modules
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
const require = createRequire(resolve(process.argv[2] || 'node_modules', '_reliability.cjs'));
const { Client } = require('pg');
const clients = [];
const connect = async user => {
  const client = new Client({ host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres', options: '-c statement_timeout=8000' });
  await client.connect(); clients.push(client);
  if (user) { await client.query('set role authenticated'); await client.query("select set_config('request.jwt.claim.sub',$1,false)",[user]); await client.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-sweetmate-chore-policy':'single-obligation-v1'})]); }
  return client;
};
const a = randomUUID(), b = randomUUID(), c = randomUUID(), home = randomUUID(), other = randomUUID();
const tag = 'reliability-' + randomUUID();
const invite = home.replaceAll('-', '').slice(0, 8).toUpperCase();
const otherInvite = other.replaceAll('-', '').slice(0, 8).toUpperCase();
const scalar = async (client, sql, args = []) => Object.values((await client.query(sql,args)).rows[0])[0];
let admin, seeded = false;
try {
  admin = await connect();
  assert.equal(await scalar(admin, 'select current_database()'), 'postgres');
  await admin.query('begin');
  for (const id of [a,b,c]) await admin.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,id+'@reliability.invalid']);
  await admin.query('insert into public.households(id,name,invite_code,created_by) values($1::uuid,$2,$6,$3),($4::uuid,$2,$7,$5)',[home,tag,a,other,b,invite,otherInvite]);
  for (const [h,u,role] of [[home,a,'owner'],[home,b,'member'],[home,c,'member'],[other,a,'member'],[other,b,'owner']])
    await admin.query("insert into public.household_members(household_id,user_id,display_name,role,status) values($1,$2,$3,$4,'active')",[h,u,u===a?'Disposable owner':'Disposable member',role]);
  await admin.query("insert into public.chores(id,household_id,title,assigned_to,due_date,completed) values($1,$2,'Saved shared chore',$3,now(),false)",[tag,home,a]);
  await admin.query("insert into public.private_borrow_items(id,household_id,owner_id,entry) values($1,$2,$3,'{\"visibility\":\"private\",\"item\":\"Private QA item\"}')",[randomUUID(),home,a]);
  await admin.query("insert into public.google_calendar_connections(user_id,refresh_token) values($1,'local-placeholder-never-sent')",[a]);
  await admin.query('commit'); seeded = true;
  const owner = await connect(a), member = await connect(b), removed = await connect(c), duplicateMember = await connect(b);
  const payload = {version:2,rotation:'round-robin',generatedTasks:[],pinnedAssignments:{},excludedAssignments:{},assignments:[a,b,c].map(memberId=>({memberId,taskIds:[],totalLoad:0}))};
  const propose = () => scalar(owner,'select public.replace_proposed_chart($1,$2)',[home,payload]);
  const old = await propose(); await owner.query('select public.approve_proposed_chart($1)',[old]);
  await member.query('begin');
  const current = await scalar(member,'select public.restart_chore_chart_review($1)',[home]);
  let finished = false;
  const staleVote = owner.query('select public.approve_proposed_chart($1)',[old]).then(()=>{finished=true;return null;},error=>{finished=true;return error;});
  await member.query('select pg_sleep(0.12)'); assert.equal(finished,false,'vote must wait for the restart transaction');
  await member.query('commit'); assert.match((await staleVote)?.message??'',/chart has changed/);
  assert.equal(await scalar(admin,'select count(*)::int from public.proposed_chart_approvals where proposed_chart_id=$1 and approved',[current]),0);
  const votes = await Promise.all([owner.query('select public.approve_proposed_chart($1)',[current]),member.query('select public.approve_proposed_chart($1)',[current]),removed.query('select public.approve_proposed_chart($1)',[current])]);
  assert.equal(votes.filter(result=>Object.values(result.rows[0])[0]==='approved').length,1);
  await member.query('begin'); const next = await scalar(member,'select public.restart_chore_chart_review($1)',[home]);
  const staleApply = owner.query('select public.apply_approved_chore_chart($1,$2)',[current,'[]']).then(()=>null,error=>error);
  await member.query('select pg_sleep(0.12)'); await member.query('commit');
  assert.match((await staleApply)?.message??'',/chart has changed/);
  assert.equal(await scalar(admin,'select applied_at from public.proposed_charts where id=$1',[current]),null);
  assert.equal(await scalar(admin,'select count(*)::int from public.chores where household_id=$1',[home]),1);
  assert.equal(await scalar(admin,'select count(*)::int from public.proposed_chart_approvals where proposed_chart_id=$1 and approved',[next]),0);
  console.log('PASS concurrent chart restart, blocked stale vote/activation, three final votes, and unchanged saved chores');

  const expenseId = tag+'-bill', op = randomUUID();
  const expense = { title:'Disposable reliability bill',amountCents:2460,paidBy:a,sharedWith:[a,b],allocations:[{participantId:a,amountCents:1230},{participantId:b,amountCents:1230}],date:'2026-11-26',category:'other' };
  const create = () => scalar(owner,'select public.mutate_expense($1,$2,$3,$4,$5,$6)',[home,op,'create',expenseId,expense,null]);
  await create(); // Simulate a committed request whose acknowledgement was lost.
  const retried = await create(); assert.equal(retried.expense.id,expenseId);
  const repayOp = randomUUID();
  const repay = client => scalar(client,'select public.mutate_expense($1,$2,$3,$4,$5,$6)',[home,repayOp,'repay',expenseId,{amountCents:300,date:'2026-11-26'},null]);
  const repayments = await Promise.all([repay(member),repay(duplicateMember)]);
  assert.deepEqual(repayments[0],repayments[1]);
  assert.equal(await scalar(admin,"select count(*)::int from public.expense_activity where expense_id=$1 and action='repay'",[expenseId]),1);
  assert.equal(await scalar(admin,"select (entry->'repaymentCents'->>$2)::int from public.expenses where id=$1",[expenseId,b]),300);
  console.log('PASS lost create acknowledgement and simultaneous repayment retry save exactly once');

  await assert.rejects(member.query('select public.remove_household_member($1,$2)',[home,c]),/host/);
  await owner.query('select public.remove_household_member($1,$2)',[home,c]);
  assert.equal(await scalar(removed,'select count(*)::int from public.chores where household_id=$1',[home]),0);
  assert.equal(await scalar(admin,'select count(*)::int from auth.users where id=$1',[c]),1);
  await assert.rejects(removed.query('select public.approve_proposed_chart($1)',[next]),/proposal|membership/);
  await member.query('select public.leave_household($1)',[home]);
  assert.equal(await scalar(member,'select count(*)::int from public.expenses where household_id=$1',[home]),0);
  await member.query('select public.join_household($1,$2,$3)',[await scalar(admin,'select invite_code from public.households where id=$1',[home]),'Disposable rejoined member','#888888']);
  assert.equal(await scalar(admin,'select role from public.household_members where household_id=$1 and user_id=$2',[home,a]),'owner');
  assert.equal(await scalar(admin,"select count(*)::int from public.household_members where household_id=$1 and status='active'",[home]),2);
  await assert.rejects(owner.query('select public.leave_household($1)',[home]),/Transfer ownership/);
  console.log('PASS host-only removal, immediate RLS denial for removed/departed users, rejoin, and owner-leave protection');

  await assert.rejects(owner.query('select public.finalize_account_deletion($1,null)',[a]),/permission denied/);
  await admin.query('select public.prepare_account_deletion($1)',[a]);
  await admin.query('select public.finalize_account_deletion($1,null)',[a]);
  assert.equal(await scalar(admin,'select count(*)::int from auth.users where id=$1',[a]),0);
  assert.equal(await scalar(owner,'select count(*)::int from public.chores where household_id=$1',[home]),0,'old JWT identity has no remaining membership');
  assert.equal(await scalar(member,'select count(*)::int from public.chores where household_id=$1',[home]),1);
  assert.equal(await scalar(admin,'select created_by::text from public.households where id=$1',[home]),b);
  assert.equal(await scalar(admin,'select count(*)::int from public.private_borrow_items where owner_id=$1',[a]),0);
  assert.equal(await scalar(admin,'select count(*)::int from public.google_calendar_connections where user_id=$1',[a]),0);
  assert.equal(await scalar(admin,'select amount_cents::int from public.expenses where id=$1',[expenseId]),2460);
  assert.equal(await scalar(admin,"select (entry->'repaymentCents'->>$2)::int from public.expenses where id=$1",[expenseId,b]),300);
  assert.equal(await scalar(admin,'select created_by::text from public.households where id=$1',[other]),b);
  await admin.query('select public.finalize_account_deletion($1,null)',[a]);
  console.log('PASS actual account finalizer, idempotent retry, ownership transfer, unchanged shared money, private/token cleanup, and revoked old identity');
} finally {
  await Promise.allSettled(clients.filter(client=>client!==admin).map(client=>client.query('rollback')));
  if (admin) {
    await admin.query('rollback');
    if(seeded) for(const user of [a,b,c]) {
      const email = await scalar(admin,'select email from auth.users where id=$1',[user]).catch(()=>undefined);
      if(email && !email.endsWith('@reliability.invalid')) throw Error('Refusing cleanup of an unrelated account');
      if(email) await admin.query('select public.finalize_account_deletion($1,null)',[user]);
    }
  }
  await Promise.allSettled(clients.map(client=>client.end()));
}
