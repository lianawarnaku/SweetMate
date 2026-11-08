// Runs 002's regression fixture first, then the additive 003 migration and new
// ledger/activity/void regressions. Real local PostgreSQL; no remote credentials.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { runExpenseDatabaseTests, ids, expensePayload, operationId } from './test-database.mjs';
export async function runExpensePaymentsDatabaseTests(db) {
  const scalar=async(sql,params=[])=>Object.values((await db.query(sql,params)).rows[0])[0];
  const login=id=>db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${id}';`);
  const rpc=(action,id,payload={},version=null,operation=operationId())=>scalar('select public.mutate_expense($1,$2,$3,$4,$5,$6)',[ids.home,operation,action,id,payload,version]);
  await login(ids.alice);
  await rpc('create','receipt-only-legacy',expensePayload());
  const oldCommittedOp=operationId();await rpc('repay','receipt-only-legacy',{},null,oldCommittedOp);
  await db.exec('reset role;');
  const payerOnly=expensePayload({amountCents:8450,amount:84.5,paidBy:ids.bob,sharedWith:[ids.bob],splits:{},manuallySettled:false});delete payerOnly.allocations;
  const noSplits=expensePayload({amountCents:3450,amount:34.5,paidBy:ids.bob,sharedWith:[ids.bob],manuallySettled:false});delete noSplits.allocations;delete noSplits.splits;
  const actualDebtor=expensePayload({amountCents:300,amount:3,paidBy:ids.bob,sharedWith:[ids.alice],splits:{[ids.alice]:3},manuallySettled:false});delete actualDebtor.allocations;
  for(const [id,payload] of [['legacy-payer-only',payerOnly],['legacy-payer-no-splits',noSplits],['legacy-actual-debtor',actualDebtor]]) await db.query(`insert into public.expenses(id,household_id,paid_by,creator_id,amount_cents,expense_date,settled,entry) values($1,$2,$3,$4,$5,'2026-11-08',false,$6)`,[id,ids.home,ids.bob,ids.alice,payload.amountCents,payload]);
  const identity=async()=>JSON.stringify((await db.query(`select id,household_id,paid_by,creator_id,amount_cents,expense_date from public.expenses order by id`)).rows);
  const identityBefore=await identity();
  const migration003=await readFile(new URL('../../supabase/migrations/202611080003_expense_payments_activity.sql',import.meta.url),'utf8');
  // Existing-but-empty allocations are not the legacy optional-metadata case.
  // A bad record must roll back all DDL/backfill, including trigger disabling.
  await db.exec('begin');
  await db.query(`insert into public.expenses(id,household_id,paid_by,creator_id,amount_cents,expense_date,entry) values('bad-payer-array',$1,$2,$3,8450,'2026-11-08',$4)`,[ids.home,ids.bob,ids.alice,{...payerOnly,allocations:[]}]);
  await assert.rejects(db.exec(migration003),/allocation/i);await db.exec('rollback');
  assert.equal(await scalar(`select tgenabled from pg_trigger where tgrelid='public.expenses'::regclass and tgname='expenses_safe_writes'`),'O','failed migration restores compatibility trigger');
  assert.equal(await scalar(`select to_regclass('public.expense_payments')::text`),null,'failed migration leaves no partial ledger schema');
  const oldBalances=(await db.query(`select id,amount_cents,settled,entry->'paidBack' paid,entry->'manuallySettled' manual,version from public.expenses order by id`)).rows;
  await db.exec(migration003);
  assert.equal(await identity(),identityBefore,'payer-only compatibility preserves financial identity/total/payer/date');
  for(const id of ['legacy-payer-only','legacy-payer-no-splits']) {
    const normalized=await scalar('select to_jsonb(e) from public.expenses e where id=$1',[id]);
    assert.equal(normalized.settled,true,'zero-debtor legacy expense auto-resolves');
    assert.deepEqual(normalized.entry.allocations,[{participantId:ids.bob,amountCents:normalized.amount_cents}]);
    assert.equal(normalized.entry.splits[ids.bob],normalized.amount_cents/100);
    assert.equal(normalized.entry.allocations.filter(a=>a.participantId!==normalized.paid_by).length,0,'normalization creates no nonpayer obligation');
  }
  const debtor=await scalar(`select entry from public.expenses where id='legacy-actual-debtor'`);
  assert.deepEqual(debtor.allocations,[{participantId:ids.alice,amountCents:300}],'valid nonpayer dollar terms remain unchanged');
  for(const before of oldBalances) {
    const after=(await db.query('select amount_cents,settled,entry,version from public.expenses where id=$1',[before.id])).rows[0];
    assert.equal(String(after.amount_cents),String(before.amount_cents));assert.equal(after.version,before.version,'backfill preserves optimistic versions');
    assert.deepEqual(after.entry.manuallySettled,before.manual);
    for(const actor of Object.keys(before.paid??{})) if(before.paid[actor]) assert.equal(after.entry.paidBack[actor],true,'legacy acknowledgements retain actual balances');
  }
  assert.equal(await scalar(`select count(*)::int from public.expense_payments where expense_id='legacy-auto' and source='legacy'`),2);
  assert.equal(await scalar(`select sum(amount_cents)::int from public.expense_payments where expense_id='legacy-auto'`),200);
  assert.equal(await scalar(`select count(*)::int from public.expense_activity where expense_id='legacy-auto' and action='import' and actor_id is null`),1,'migration is labelled import, never a fabricated user action');
  await login(ids.alice);
  const receiptReplay=await rpc('repay','receipt-only-legacy',{_receiptOnly:true},null,oldCommittedOp);
  assert.equal(receiptReplay.expense.entry.repaymentCents[ids.alice],100,'receipt-only accepts a real pre-003 committed full-payment receipt');
  await rpc('repay','receipt-only-legacy',{_receiptOnly:true},null,oldCommittedOp);
  assert.equal(await scalar(`select count(*)::int from public.expense_payments where expense_id='receipt-only-legacy'`),1,'receipt-only replay creates no duplicate imported payment');
  assert.equal(await scalar(`select count(*)::int from public.expense_activity where expense_id='receipt-only-legacy'`),1,'receipt-only replay creates no new activity');
  let review=(await rpc('create','receipt-only-review',expensePayload())).expense;
  const rejectedRepayOp=operationId();
  await assert.rejects(rpc('repay','receipt-only-review',{_receiptOnly:true},null,rejectedRepayOp),/Review the repayment amount\/record/);
  assert.equal(await scalar(`select count(*)::int from public.expense_payments where expense_id='receipt-only-review'`),0,'uncommitted old full-share intent never pays current remaining');
  review=(await rpc('repay','receipt-only-review',{amountCents:40})).expense;
  const rejectedUndoOp=operationId();
  await assert.rejects(rpc('undo_repay','receipt-only-review',{_receiptOnly:true},null,rejectedUndoOp),/Review the repayment amount\/record/);
  assert.equal((await scalar(`select entry from public.expenses where id='receipt-only-review'`)).repaymentCents[ids.alice],40,'uncommitted old undo intent never reverses latest new payment');
  assert.equal(await scalar(`select count(*)::int from public.expense_activity where expense_id='receipt-only-review'`),2,'rejected receipt-only intents create no activity');
  await db.exec('reset role;');
  assert.equal(await scalar(`select count(*)::int from public.expense_operation_receipts where operation_id=any($1::uuid[])`,[[rejectedRepayOp,rejectedUndoOp]]),0,'rejected receipt-only intents leave no receipts');
  await login(ids.alice);
  const createOp=operationId();
  let row=(await rpc('create','partial-bill',expensePayload({repaymentCents:{[ids.alice]:100000},repayments:[{id:operationId(),amountCents:100000}],voidedAt:'2020-01-01',manuallySettled:true}),null,createOp)).expense;
  assert.deepEqual(row.entry.repaymentCents,{});assert.deepEqual(row.entry.repayments,[]);assert.equal(row.entry.voidedAt,undefined);assert.equal(row.entry.manuallySettled,false);
  const firstOp=operationId();
  row=(await rpc('repay','partial-bill',{amountCents:40,date:'2026-01-02'},null,firstOp)).expense;
  assert.equal(row.entry.repaymentCents[ids.alice],40);assert.equal(row.entry.paidBack[ids.alice],undefined);assert.equal(row.settled,false);
  const first=row.entry.repayments[0];assert.equal(first.amountCents,40);assert.equal(first.date,'2026-01-02');assert.equal(first.actorId,ids.alice);assert.equal(first.legacy,false);assert.ok(first.recordedAt);
  assert.equal((await rpc('repay','partial-bill',{amountCents:40,date:'2026-01-02'},null,firstOp)).expense.entry.repayments.length,1,'same operation cannot add a second payment');
  for(const amountCents of [0,-1,0.1,61,Number.MAX_SAFE_INTEGER+1,null]) await assert.rejects(rpc('repay','partial-bill',{amountCents}),/positive integer cents/);
  for(const date of ['2026-02-30','01/02/2026','2026-01-01T12:00:00Z']) await assert.rejects(rpc('repay','partial-bill',{amountCents:1,date}));
  row=(await rpc('repay','partial-bill',{amountCents:30})).expense;
  assert.equal(row.entry.repaymentCents[ids.alice],70);const second=row.entry.repayments.find(p=>p.id!==first.id);
  row=(await rpc('undo_repay','partial-bill',{paymentId:first.id})).expense;
  assert.equal(row.entry.repaymentCents[ids.alice],30);assert.ok(row.entry.repayments.find(p=>p.id===first.id).reversedAt);
  assert.equal(row.entry.repayments.find(p=>p.id===first.id).reversedBy,ids.alice);
  row=(await rpc('undo_repay','partial-bill')).expense;
  assert.deepEqual(row.entry.repaymentCents,{});assert.ok(row.entry.repayments.find(p=>p.id===second.id).reversedAt);assert.equal(row.entry.financialHistory,true);
  await assert.rejects(rpc('update','partial-bill',{date:'2026-11-09'},row.version),/locked/,'reversing every payment never unlocks financial edits');
  await assert.rejects(rpc('undo_repay','partial-bill',{paymentId:first.id}),/active repayment/);
  await login(ids.carol);row=(await rpc('repay','partial-bill',{amountCents:25})).expense;
  const carolPayment=row.entry.repayments.find(p=>p.actorId===ids.carol);
  await login(ids.alice);await assert.rejects(rpc('undo_repay','partial-bill',{paymentId:carolPayment.id}),/active repayment/);
  await login(ids.bob);row=(await rpc('settle','partial-bill',{},row.version)).expense;
  await login(ids.carol);await assert.rejects(rpc('undo_repay','partial-bill',{paymentId:carolPayment.id}),/Reopen/);
  await login(ids.bob);row=(await rpc('reopen','partial-bill',{},row.version)).expense;
  assert.equal(row.entry.repaymentCents[ids.carol],25);assert.equal(row.settled,false);
  await login(ids.alice);row=(await rpc('repay','partial-bill')).expense;
  assert.equal(row.entry.repaymentCents[ids.alice],100,'omitting amount pays only remaining cents');assert.equal(row.entry.paidBack[ids.alice],true);
  await assert.rejects(rpc('repay','partial-bill'),/remaining share/);
  await login(ids.carol);row=(await rpc('repay','partial-bill')).expense;
  assert.equal(row.entry.repaymentCents[ids.carol],100);assert.equal(row.settled,true);
  await login(ids.bob);
  const beforeVoid=structuredClone(row);const voidOp=operationId();
  let voided=await rpc('delete','partial-bill',{},row.version,voidOp);row=voided.expense;
  assert.equal(voided.deleted,false);assert.ok(row.entry.voidedAt);assert.equal(row.entry.voidedBy,ids.bob);assert.equal(row.settled,beforeVoid.settled);
  assert.deepEqual(row.entry.repayments,beforeVoid.entry.repayments);assert.deepEqual(row.entry.repaymentCents,beforeVoid.entry.repaymentCents);
  assert.equal((await rpc('delete','partial-bill',{},beforeVoid.version,voidOp)).expense.entry.voidedAt,row.entry.voidedAt);
  await assert.rejects(rpc('repay','partial-bill',{amountCents:1}),/Restore/);
  await assert.rejects(rpc('update','partial-bill',{title:'Hidden edit'},row.version),/Restore/);
  await assert.rejects(rpc('restore','partial-bill',{},1),/changed/);
  await login(ids.carol);await assert.rejects(rpc('restore','partial-bill',{},row.version),/payer, creator or host/);
  await login(ids.owner);row=(await rpc('restore','partial-bill',{},row.version)).expense;
  assert.equal(row.entry.voidedAt,undefined);assert.equal(row.entry.voidedBy,undefined);assert.deepEqual(row.entry.repaymentCents,beforeVoid.entry.repaymentCents);
  await login(ids.alice);
  assert.equal((await rpc('create','partial-bill',expensePayload({repaymentCents:{[ids.alice]:100000},repayments:[{id:operationId(),amountCents:100000}],voidedAt:'2020-01-01',manuallySettled:true}),null,createOp).catch(()=>null)),null,'receipt payload cannot change across retries');
  // Use a separate uncomplicated request to verify replay returns current void.
  const replayOp=operationId();let replay=(await rpc('create','void-replay',expensePayload(),null,replayOp)).expense;
  replay=(await rpc('delete','void-replay',{},replay.version)).expense;
  assert.ok((await rpc('create','void-replay',expensePayload(),null,replayOp)).expense.entry.voidedAt,'lost create response cannot undo later void');
  const events=(await db.query(`select action,amount_cents,payment_id,summary from public.expense_activity where household_id=$1 and expense_id='partial-bill' order by created_at,id`,[ids.home])).rows;
  assert.equal(events.filter(e=>e.action==='create').length,1);assert.equal(events.filter(e=>e.action==='void').length,1);assert.equal(events.filter(e=>e.action==='restore').length,1);
  assert.equal(events.filter(e=>e.action==='repay').length,5);assert.equal(events.filter(e=>e.action==='undo_repay').length,2);
  assert.ok(events.every(e=>!e.summary.includes('outbox')&&!e.summary.includes('payload')));
  for(const table of ['expense_payments','expense_activity']) {
    await assert.rejects(db.query(`update public.${table} set actor_id=$1`,[ids.carol]),/permission denied/);
    await assert.rejects(db.query(`delete from public.${table}`),/permission denied/);
  }
  await login(ids.other);assert.equal(await scalar(`select count(*)::int from public.expense_activity where household_id=$1`,[ids.home]),0);
  await login(ids.former);assert.equal(await scalar(`select count(*)::int from public.expense_activity where household_id=$1`,[ids.home]),0);
  await login(ids.alice);
  // Build42 snapshots may add only remaining cents, never replace ledger state.
  let legacy=(await rpc('create','ledger-legacy',expensePayload())).expense;
  legacy=(await rpc('repay','ledger-legacy',{amountCents:40})).expense;
  const staleLegacy=structuredClone(legacy);
  const legacyWrite=snapshot=>db.query(`insert into public.expenses select * from jsonb_populate_record(null::public.expenses,$1) on conflict(id) do update set entry=excluded.entry,settled=excluded.settled,updated_at=excluded.updated_at returning to_jsonb(expenses) row`,[snapshot]);
  let saved=(await legacyWrite({...legacy,entry:{...legacy.entry,paidBack:{[ids.alice]:true},repaymentCents:{[ids.alice]:999999},repayments:[]},updated_at:new Date().toISOString()})).rows[0].row;
  assert.equal(saved.entry.repaymentCents[ids.alice],100);assert.equal(saved.entry.repayments.length,2);assert.equal(saved.entry.repayments.find(p=>p.amountCents===60).actorId,ids.alice);
  assert.equal((await legacyWrite({...staleLegacy,entry:{...staleLegacy.entry,repaymentCents:{[ids.alice]:99999},repayments:[]}})).rows.length,0,'legacy no-op cannot erase partial history');
  saved=(await rpc('undo_repay','ledger-legacy')).expense;
  assert.equal(saved.entry.repaymentCents[ids.alice],40);
  await assert.rejects(legacyWrite({...legacy,entry:{...legacy.entry,paidBack:{[ids.alice]:true}},updated_at:'2099-01-01'}),/updated app.*correction/);
  saved=(await rpc('delete','ledger-legacy',{},saved.version)).expense;
  assert.equal((await legacyWrite({...staleLegacy,entry:{...staleLegacy.entry,paidBack:{[ids.alice]:true}},updated_at:'2099-01-01'})).rows.length,0,'old snapshot cannot act on voided expense');
  assert.ok((await scalar(`select entry from public.expenses where id='ledger-legacy'`)).voidedAt);
  // Legacy creation is still accepted without accepting forged ledger/void data.
  const freshDate=new Date().toISOString();
  await legacyWrite({...legacy,id:'ledger-legacy-create',created_at:freshDate,updated_at:freshDate,version:1,entry:{...expensePayload(),id:'ledger-legacy-create',creatorId:ids.alice,repaymentCents:{[ids.alice]:100},repayments:[],voidedAt:'2020-01-01'}});
  const fresh=await scalar(`select entry from public.expenses where id='ledger-legacy-create'`);assert.deepEqual(fresh.repaymentCents,{});assert.equal(fresh.voidedAt,undefined);
  // Foreign-key cleanup must include immutable ledger and activity records.
  await db.exec('reset role;');const cleanup='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  await db.query(`insert into public.households(id,name,invite_code,created_by) values($1,'Ledger cleanup','LEDGER01',$2)`,[cleanup,ids.owner]);
  for(const key of ['owner','alice','bob','carol']) await db.query(`insert into public.household_members(household_id,user_id,display_name,role,status) values($1,$2,$3,$4,'active')`,[cleanup,ids[key],key,key==='owner'?'owner':'member']);
  await login(ids.alice);
  await scalar('select public.mutate_expense($1,$2,$3,$4,$5,$6)',[cleanup,operationId(),'create','ledger-cleanup',expensePayload(),null]);
  await scalar('select public.mutate_expense($1,$2,$3,$4,$5,$6)',[cleanup,operationId(),'repay','ledger-cleanup',{amountCents:40},null]);
  await login(ids.owner);await db.query('select public.delete_household($1)',[cleanup]);await db.exec('reset role;');
  for(const table of ['expenses','expense_payments','expense_activity','expense_operation_receipts','expense_legacy_correction_barriers']) assert.equal(await scalar(`select count(*)::int from public.${table} where household_id=$1`,[cleanup]),0,`authorized cleanup cascades ${table}`);
  console.log('PASS: additive 003 migration preserves legacy balances, partial/full repayment ledger, own reversals/date validation, permanent financial locks, recoverable void/restore, read-only visible activity/idempotency, legacy snapshot safety and household cleanup.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const {PGlite}=await import(process.argv[2]||'@electric-sql/pglite');const db=new PGlite();
  try{await runExpenseDatabaseTests(db);await runExpensePaymentsDatabaseTests(db);}finally{await db.close();}
}
