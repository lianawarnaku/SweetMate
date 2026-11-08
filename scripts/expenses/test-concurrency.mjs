// npm install --prefix /tmp/sweetmate-db-tests embedded-postgres pg
// node scripts/expenses/test-concurrency.mjs /tmp/sweetmate-db-tests/node_modules
// Uses disposable PostgreSQL on localhost only. Never reads remote credentials.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runExpenseDatabaseTests, ids, operationId, expensePayload } from './test-database.mjs';
import { runExpensePaymentsDatabaseTests } from './test-payments-database.mjs';
const modules = process.argv[2];
const { default: EmbeddedPostgres } = await import(modules ? `${modules}/embedded-postgres/dist/index.js` : 'embedded-postgres');
const directory = await mkdtemp(join(tmpdir(),'sweetmate-expense-postgres-'));
const postgres = new EmbeddedPostgres({databaseDir:join(directory,'data'),port:55482,user:'postgres',password:'disposable-local-test',persistent:false,
  postgresFlags:['-c','listen_addresses=127.0.0.1','-c',`unix_socket_directories=${directory}`],onLog:()=>{},onError:message=>{if(!String(message).includes('NOTICE'))console.error(message);}});
const clients=[];
const connect = async id => { const client=postgres.getPgClient();await client.connect();clients.push(client);if(id)await client.query(`set role authenticated; set request.jwt.claim.sub='${id}'; set statement_timeout='8s';`);return client; };
const rpc = async (client,action,id,payload={},version=null,operation=operationId()) => (await client.query('select public.mutate_expense($1,$2,$3,$4,$5,$6) result',[ids.home,operation,action,id,payload,version])).rows[0].result;
try {
  await postgres.initialise();await postgres.start();
  const admin=await connect();
  const database={exec:sql=>admin.query(sql),query:(sql,params)=>admin.query(sql,params)};
  await runExpenseDatabaseTests(database);
  await runExpensePaymentsDatabaseTests(database);
  const alice=await connect(ids.alice);const carol=await connect(ids.carol);const peerAlice=await connect(ids.alice);
  await rpc(alice,'create','concurrent-repay',expensePayload());
  await alice.query('begin');await rpc(alice,'repay','concurrent-repay');
  let finished=false;
  const second=rpc(carol,'repay','concurrent-repay').then(result=>{finished=true;return result;});
  await alice.query('select pg_sleep(0.15)');assert.equal(finished,false,'second repayment must wait for actual row lock');
  await alice.query('commit');
  const both=await second;
  assert.deepEqual(both.expense.entry.paidBack,{[ids.alice]:true,[ids.carol]:true});assert.equal(both.expense.settled,true);

  const op=operationId();
  await alice.query('begin');const firstReceipt=await rpc(alice,'create','concurrent-retry',expensePayload(),null,op);
  let retried=false;const retry=rpc(peerAlice,'create','concurrent-retry',expensePayload(),null,op).then(result=>{retried=true;return result;});
  await alice.query('select pg_sleep(0.15)');assert.equal(retried,false);await alice.query('commit');
  assert.deepEqual(await retry,firstReceipt,'concurrent create retry returns current created row once');
  assert.equal((await admin.query(`select count(*)::int count from public.expenses where id='concurrent-retry'`)).rows[0].count,1);

  await admin.query(`insert into public.shopping_lists(id,household_id,name,sort_order,entry) values('race-list',$1,'Race',0,'{}');`,[ids.home]);
  await admin.query(`insert into public.shopping_items(id,household_id,list_id,name,sort_order,entry) values('race-item',$1,'race-list','Race item',0,'{"price":3}')`,[ids.home]);
  const sourcePayload=expensePayload({shoppingSource:{type:'shopping-item',householdId:ids.home,shoppingListId:'race-list',shoppingItemIds:['race-item']}});
  await alice.query('begin');await rpc(alice,'create','source-first',sourcePayload);
  const duplicate=assert.rejects(rpc(peerAlice,'create','source-second',sourcePayload),/already/);
  await alice.query('select pg_sleep(0.15)');await alice.query('commit');await duplicate;
  assert.equal((await admin.query(`select count(*)::int count from public.expense_shopping_claims where source_id='race-item'`)).rows[0].count,1);

  // Old full-row snapshots must coexist with RPCs without a reverse lock order.
  const compat=(await rpc(alice,'create','mixed-client',expensePayload())).expense;
  await alice.query('begin');
  await alice.query(`update public.expenses set entry=entry||$1::jsonb,updated_at=clock_timestamp() where id='mixed-client'`,[{paidBack:{[ids.alice]:true}}]);
  const modern=rpc(carol,'repay','mixed-client');
  await alice.query('select pg_sleep(0.15)');await alice.query('commit');
  assert.deepEqual((await modern).expense.entry.paidBack,{[ids.alice]:true,[ids.carol]:true});

  // An ON CONFLICT legacy upsert locks the existing row before household state.
  const mixedRow=(await rpc(alice,'create','mixed-upsert',expensePayload())).expense;
  await carol.query('begin');await rpc(carol,'repay','mixed-upsert');
  const legacyUpsert=alice.query(`insert into public.expenses select * from jsonb_populate_record(null::public.expenses,$1) on conflict(id) do update set entry=excluded.entry,updated_at=excluded.updated_at returning entry`,[{...mixedRow,entry:{...mixedRow.entry,paidBack:{[ids.alice]:true}}}]);
  await carol.query('select pg_sleep(0.15)');await carol.query('commit');
  assert.deepEqual((await legacyUpsert).rows[0].entry.paidBack,{[ids.alice]:true,[ids.carol]:true});

  // A stale version can never settle over a repayment that committed first.
  const versioned=(await rpc(alice,'create','version-race',expensePayload())).expense;
  await carol.query('begin');await rpc(carol,'repay','version-race');
  const stale=assert.rejects(rpc(alice,'settle','version-race',{},versioned.version),/changed/);
  await carol.query('select pg_sleep(0.15)');await carol.query('commit');await stale;
  const current=(await admin.query(`select entry from public.expenses where id='version-race'`)).rows[0].entry;
  assert.equal(current.paidBack[ids.carol],true);assert.equal(current.manuallySettled,false);
  // Once a correction commits, a waiting old-client snapshot cannot reverse it.
  await rpc(alice,'create','undo-race',expensePayload());
  const oldPaid=(await rpc(alice,'repay','undo-race')).expense;
  await alice.query('begin');await rpc(alice,'undo_repay','undo-race');
  const stalePaid=assert.rejects(peerAlice.query(`update public.expenses set entry=$1,updated_at='2099-01-01' where id='undo-race'`,[oldPaid.entry]),/updated app.*correction/);
  await alice.query('select pg_sleep(0.15)');await alice.query('commit');await stalePaid;
  const oldManual=(await rpc(alice,'settle','undo-race',{},3)).expense;
  await alice.query('begin');await rpc(alice,'reopen','undo-race',{},oldManual.version);
  const staleSettled=assert.rejects(peerAlice.query(`update public.expenses set entry=$1,settled=true,updated_at='2099-01-01' where id='undo-race'`,[oldManual.entry]),/updated app.*reopening/);
  await alice.query('select pg_sleep(0.15)');await alice.query('commit');await staleSettled;
  const protectedRecord=(await admin.query(`select entry from public.expenses where id='undo-race'`)).rows[0].entry;
  assert.deepEqual(protectedRecord.paidBack,{});assert.equal(protectedRecord.manuallySettled,false);
  // Same-person overlapping partial payments cannot overpay one share.
  await rpc(alice,'create','partial-overpay-race',expensePayload());
  await alice.query('begin');await rpc(alice,'repay','partial-overpay-race',{amountCents:60,date:'2026-01-02'});
  const overpay=assert.rejects(rpc(peerAlice,'repay','partial-overpay-race',{amountCents:60}),/remaining share/);
  await alice.query('select pg_sleep(0.15)');await alice.query('commit');await overpay;
  const partial=(await admin.query(`select entry from public.expenses where id='partial-overpay-race'`)).rows[0].entry;
  assert.equal(partial.repaymentCents[ids.alice],60);assert.equal(partial.repayments.length,1);
  assert.equal((await admin.query(`select count(*)::int count from public.expense_activity where expense_id='partial-overpay-race' and action='repay'`)).rows[0].count,1,'failed concurrent overpayment adds no activity');

  await rpc(alice,'create','partial-merge-race',expensePayload());
  await alice.query('begin');await rpc(alice,'repay','partial-merge-race',{amountCents:30});
  const mergedPartial=rpc(peerAlice,'repay','partial-merge-race',{amountCents:40});
  await alice.query('select pg_sleep(0.15)');await alice.query('commit');
  assert.equal((await mergedPartial).expense.entry.repaymentCents[ids.alice],70);

  const paymentRetryOp=operationId();await rpc(alice,'create','partial-retry-race',expensePayload());
  await alice.query('begin');await rpc(alice,'repay','partial-retry-race',{amountCents:25},null,paymentRetryOp);
  const paymentRetry=rpc(peerAlice,'repay','partial-retry-race',{amountCents:25},null,paymentRetryOp);
  await alice.query('select pg_sleep(0.15)');await alice.query('commit');
  const retriedPayment=(await paymentRetry).expense;
  assert.equal(retriedPayment.entry.repaymentCents[ids.alice],25);assert.equal(retriedPayment.entry.repayments.length,1);
  assert.equal((await admin.query(`select count(*)::int count from public.expense_activity where expense_id='partial-retry-race' and action='repay'`)).rows[0].count,1,'one idempotent payment has one activity event');

  const beforeReverse=(await rpc(alice,'repay','partial-retry-race',{amountCents:25})).expense;
  await alice.query('begin');await rpc(alice,'undo_repay','partial-retry-race');
  const staleVoid=assert.rejects(rpc(peerAlice,'delete','partial-retry-race',{},beforeReverse.version),/changed/);
  await alice.query('select pg_sleep(0.15)');await alice.query('commit');await staleVoid;
  const afterReverse=(await admin.query(`select entry from public.expenses where id='partial-retry-race'`)).rows[0].entry;
  assert.equal(afterReverse.voidedAt,undefined);assert.equal(afterReverse.repaymentCents[ids.alice],25);
  console.log('PASS: native PostgreSQL independent/partial repayments, overpayment serialization, payment/activity retries, unique shopping conversion, mixed legacy/RPC locks, stale versions, correction barriers and recoverable void races.');


} finally {
  await Promise.allSettled(clients.map(client=>client.end()));await postgres.stop();await rm(directory,{recursive:true,force:true});
}
