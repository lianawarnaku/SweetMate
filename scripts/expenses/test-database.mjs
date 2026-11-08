// Real PostgreSQL migration/authorization/accounting tests. No remote credentials.
// node scripts/expenses/test-database.mjs /absolute/path/to/@electric-sql/pglite/dist/index.js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export const ids = {
  owner: '11111111-1111-4111-8111-111111111111', alice: '22222222-2222-4222-8222-222222222222',
  bob: '33333333-3333-4333-8333-333333333333', carol: '44444444-4444-4444-8444-444444444444',
  former: '55555555-5555-4555-8555-555555555555', other: '66666666-6666-4666-8666-666666666666',
  home: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', otherHome: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};
let sequence = 0;
export const operationId = () => `dddddddd-dddd-4ddd-8ddd-${String(++sequence).padStart(12, '0')}`;
export const expensePayload = (patch = {}) => ({
  title: 'Shared bill', amountCents: 300, amount: 3, paidBy: ids.bob,
  sharedWith: [ids.alice, ids.bob, ids.carol],
  allocations: [ids.alice, ids.bob, ids.carol].map(participantId => ({ participantId, amountCents: 100 })),
  splits: { [ids.alice]: 1, [ids.bob]: 1, [ids.carol]: 1 }, date: '2026-11-08', category: 'other', settled: false, ...patch,
});
export async function runExpenseDatabaseTests(db) {
  const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
  const login = async (id) => db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${id}';`);
  const rpc = (action, id, payload = {}, version = null, operation = operationId()) => scalar('select public.mutate_expense($1,$2,$3,$4,$5,$6)', [ids.home, operation, action, id, payload, version]);
  const migrate = async name => {
    let sql = await readFile(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
    sql = sql.replace('create extension if not exists pgcrypto;', '');
    await db.exec(sql);
  };
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create publication supabase_realtime;
    alter default privileges in schema public grant select,insert,update,delete on tables to authenticated;`);
  for (const user of ['owner', 'alice', 'bob', 'carol', 'former', 'other']) await db.query('insert into auth.users values($1)', [ids[user]]);
  for (const name of ['202607220001_household_realtime','202607220002_household_memberships','202607260001_multi_sweet_memberships','202608260003_shared_owner_check','202607300005_sole_owner_household_delete','202608270001_expenses_table','202608270002_shopping_tables']) await migrate(name);
  await db.query(`insert into public.households(id,name,invite_code,created_by) values($1,'Home','HOME0001',$2),($3,'Other','HOME0002',$4)`, [ids.home, ids.owner, ids.otherHome, ids.other]);
  for (const user of ['owner','alice','bob','carol','former','other']) await db.query(`insert into public.household_members(household_id,user_id,display_name,role,status) values($1,$2,$3,$4,$5)`, [user === 'other' ? ids.otherHome : ids.home, ids[user], user, user === 'owner' || user === 'former' || user === 'other' ? 'owner' : 'member', user === 'former' ? 'left' : 'active']);
  await db.query(`insert into public.shopping_lists(id,household_id,name,sort_order,entry) values('old-list',$1,'Old groceries',0,'{}'),('groceries',$1,'Groceries',1,'{}'),('manual-list',$1,'Unpriced',2,'{}'),('other-list',$2,'Other household',0,'{}')`, [ids.home, ids.otherHome]);
  for (const [id,list,price] of [['old-item','old-list',3],['apples','groceries',0.2],['bread','groceries',0.8],['unpriced','manual-list',undefined],['priced','manual-list',1]]) await db.query(`insert into public.shopping_items(id,household_id,list_id,name,sort_order,entry) values($1,$2,$3,$1,0,$4)`, [id,ids.home,list,price === undefined ? {} : {price}]);
  const oldEntry = expensePayload({ shoppingSource: { type: 'shopping-item',householdId:ids.home,shoppingListId:'old-list',shoppingItemIds:['old-item'] } });
  await db.query(`insert into public.expenses(id,household_id,paid_by,creator_id,amount_cents,expense_date,entry) values('legacy',$1,$2,null,300,'2026-11-08',$3),('legacy-source',$1,$2,$4,300,'2026-11-08',$5)`, [ids.home,ids.bob,expensePayload(),ids.alice,oldEntry]);
  const automatic=expensePayload({paidBack:{[ids.alice]:true,[ids.carol]:true},settled:true});
  await db.query(`insert into public.expenses(id,household_id,paid_by,creator_id,amount_cents,expense_date,settled,entry) values('legacy-manual',$1,$2,$3,300,'2026-11-08',true,$4),('legacy-auto',$1,$2,$3,300,'2026-11-08',true,$5)`,[ids.home,ids.bob,ids.alice,expensePayload({settled:true}),automatic]);
  await migrate('202611080002_expense_mutations');
  assert.equal(await scalar(`select relreplident from pg_class where oid='public.expenses'::regclass`),'f');
  assert.equal(await scalar(`select count(*)::int from public.expense_shopping_claims where source_id='old-item'`),1,'backfill reserves historical sources without modifying debt');
  assert.equal(await scalar(`select entry->>'manuallySettled' from public.expenses where id='legacy-manual'`),'true');
  assert.equal(await scalar(`select entry->>'manuallySettled' from public.expenses where id='legacy-auto'`),'false');
  assert.equal(await scalar(`select amount_cents::int from public.expenses where id='legacy-manual'`),300,'legacy backfill changes no financial fields');
  await login(ids.alice);
  let created = await rpc('create','bill',expensePayload({ splits: { [ids.alice]: 1000000 } }));
  assert.equal(created.expense.version,1);
  assert.equal(created.expense.entry.splits[ids.alice],1,'dollar aliases derive from integer allocations, never caller dollar claims');
  assert.equal(created.expense.creator_id,ids.alice);
  assert.equal(created.expense.entry.date,'2026-11-08');
  for (const patch of [
    { amountCents: 3.1 }, { amountCents: 0 }, { date:'2026-02-30' }, { date:'2026-11-08T00:00:00Z' },
    { sharedWith:[ids.alice,ids.alice] }, { allocations:[{participantId:ids.alice,amountCents:300}] },
    { paidBy:ids.former }, { sharedWith:[ids.former],allocations:[{participantId:ids.former,amountCents:300}] },
    { allocations:[{participantId:ids.alice,amountCents:100},{participantId:ids.bob,amountCents:-100},{participantId:ids.carol,amountCents:300}] },
    { category:'unknown' }, { title:33 }, { notes:{} },
  ]) await assert.rejects(rpc('create',`bad-${operationId()}`,expensePayload(patch)));
  await assert.rejects(rpc('create','wrong-actor',expensePayload({_expectedActorId:ids.bob})),/account changed/);
  const actorOperation=operationId();
  const expectedActorRecord=await rpc('create','expected-actor',expensePayload({_expectedActorId:ids.alice}),null,actorOperation);
  assert.equal(expectedActorRecord.expense.entry._expectedActorId,undefined,'transport actor guard must not enter stored expense');
  assert.deepEqual(await rpc('create','expected-actor',expensePayload(),null,actorOperation),expectedActorRecord,'transport actor metadata does not change receipt identity');
  await assert.rejects(rpc('create','fake-creator',expensePayload({creatorId:ids.bob})),/creator/);
  await assert.rejects(rpc('update','bill',{creatorId:ids.bob},1),/immutable/);
  await assert.rejects(rpc('update','bill',{householdId:ids.otherHome},1),/immutable/);
  await assert.rejects(rpc('update','bill',{title:'stale'},0),/changed/);
  await login(ids.carol);
  await assert.rejects(rpc('update','bill',{title:'forbidden'},1),/creator/);
  await assert.rejects(rpc('settle','bill',{},1),/payer, creator or host/);
  await assert.rejects(rpc('delete','legacy',{},1),/payer, creator or host/,'null legacy creator must not bypass authorization');
  await login(ids.former); await assert.rejects(rpc('repay','bill'),/membership/);
  await login(ids.other); await assert.rejects(rpc('repay','bill'),/membership/);
  await login(ids.bob); await assert.rejects(rpc('repay','bill'),/positive share/);
  await login(ids.alice);
  const repaymentOp = operationId();
  const paidAlice = await rpc('repay','bill',{},null,repaymentOp);
  assert.equal(paidAlice.expense.entry.paidBack[ids.alice],true);
  await assert.rejects(rpc('update','bill',expensePayload({amountCents:600,allocations:[ids.alice,ids.bob,ids.carol].map(participantId=>({participantId,amountCents:200}))}),2),/locked/);
  await assert.rejects(rpc('update','bill',{date:'2026-11-09'},2),/locked/);
  await assert.rejects(rpc('update','bill',{splitMode:'exact'},2),/locked/);
  let updated = await rpc('update','bill',{title:'Updated description'},2);
  assert.equal(updated.expense.entry.paidBack[ids.alice],true);
  assert.equal(updated.expense.entry.title,'Updated description');
  await assert.rejects(rpc('repay','other-id',{},null,repaymentOp),/different request/);
  await login(ids.carol);
  let paidBoth = await rpc('repay','bill');
  assert.deepEqual(paidBoth.expense.entry.paidBack,{[ids.alice]:true,[ids.carol]:true});
  assert.equal(paidBoth.expense.settled,true,'all positive debts auto-settle');
  let undone = await rpc('undo_repay','bill'); assert.equal(undone.expense.settled,false); assert.equal(undone.expense.entry.paidBack[ids.alice],true);
  await login(ids.bob);
  let settled = await rpc('settle','bill',{},undone.expense.version); assert.equal(settled.expense.entry.manuallySettled,true,'payer can settle another creator expense');
  await login(ids.carol); await assert.rejects(rpc('undo_repay','bill'),/Reopen/);
  await rpc('repay','bill');
  await login(ids.owner);
  let reopened = await rpc('reopen','bill',{},settled.expense.version+1);
  assert.equal(reopened.expense.entry.manuallySettled,false); assert.equal(reopened.expense.settled,true,'reopen preserves actual repayments');
  await login(ids.carol); const correction = await rpc('undo_repay','bill'); assert.equal(correction.expense.settled,false);
  await login(ids.alice);
  await assert.rejects(rpc('delete','bill',{},1),/changed/);
  const latestOnRetry = await rpc('repay','bill',{},null,repaymentOp);
  assert.equal(latestOnRetry.expense.version,correction.expense.version,'receipt replay returns current state');
  await login(ids.owner); await rpc('delete','bill',{},correction.expense.version);
  await login(ids.alice);
  const deletedOnRetry = await rpc('repay','bill',{},null,repaymentOp);
  assert.deepEqual(deletedOnRetry,{expense:null,deleted:true,id:'bill'},'lost response retry must not resurrect deleted state');
  await assert.rejects(rpc('create','bill',expensePayload()),/deleted/);
  const onlyPayer = await rpc('create','payer-only',expensePayload({sharedWith:[ids.bob],allocations:[{participantId:ids.bob,amountCents:300}]}));
  assert.equal(onlyPayer.expense.settled,true,'no debtor expense has no outstanding debt');
  const zero = await rpc('create','zero-share',expensePayload({allocations:[{participantId:ids.alice,amountCents:300},{participantId:ids.bob,amountCents:0},{participantId:ids.carol,amountCents:0}]}));
  await login(ids.carol); await assert.rejects(rpc('repay','zero-share'),/positive/);
  await login(ids.alice); assert.equal((await rpc('repay','zero-share')).expense.settled,true,'zero shares do not block settlement');

  const source = (type,list,item) => ({type,householdId:ids.home,shoppingListId:list,shoppingItemIds:item?[item]:[]});
  const amount = (cents,shoppingSource) => expensePayload({amountCents:cents,allocations:[{participantId:ids.alice,amountCents:cents},{participantId:ids.bob,amountCents:0},{participantId:ids.carol,amountCents:0}],shoppingSource});
  await assert.rejects(rpc('create','wrong-house-source',amount(20,source('shopping-item','other-list','apples'))),/belong/);
  await assert.rejects(rpc('create','wrong-price',amount(30,source('shopping-item','groceries','apples'))),/stored shopping item price/);
  const apple = await rpc('create','apple-expense',amount(20,source('shopping-item','groceries','apples')));
  assert.equal(await scalar(`select entry->>'convertedExpenseId' from public.shopping_items where id='apples'`),'apple-expense','Shopping link commits atomically with source expense');
  assert.equal(await scalar(`select completed from public.shopping_items where id='apples'`),false,'converting an expense never completes Shopping');
  await assert.rejects(rpc('create','apple-duplicate',amount(20,source('shopping-item','groceries','apples'))),/already/);
  await rpc('delete','apple-expense',{},apple.expense.version);
  await assert.rejects(rpc('create','apple-after-delete',amount(20,source('shopping-item','groceries','apples'))),/already/);
  await assert.rejects(rpc('create','wrong-remainder',amount(100,{...source('shopping-list','groceries'),listTotalCents:100})),/durable individual claims/);
  let list = await rpc('create','list-expense',amount(80,{...source('shopping-list','groceries'),listTotalCents:100}));
  assert.equal(list.expense.entry.shoppingSource.individuallyAllocatedCents,20);
  await assert.rejects(rpc('create','list-duplicate',amount(80,{...source('shopping-list','groceries'),listTotalCents:100})),/already/);
  await rpc('delete','list-expense',{},list.expense.version);
  await assert.rejects(rpc('create','bread-after-list',amount(80,source('shopping-item','groceries','bread'))),/already/);
  await assert.rejects(rpc('create','old-item-duplicate',amount(300,source('shopping-item','old-list','old-item'))),/already/);
  await rpc('create','manual-item',amount(50,source('shopping-item','manual-list','unpriced')));
  await assert.rejects(rpc('create','below-known-floor',amount(40,{...source('shopping-list','manual-list'),listTotalCents:90})),/stored prices/);
  await rpc('create','manual-total',amount(150,{...source('shopping-list','manual-list'),listTotalCents:200}));

  // Whole-row build 42 writes remain safe and monotonic during staged rollout.
  const legacyCreated = await rpc('create','compat',expensePayload());
  const row = legacyCreated.expense;
  const direct = async (snapshot) => db.query(`insert into public.expenses select * from jsonb_populate_record(null::public.expenses,$1) on conflict(id) do update set household_id=excluded.household_id,creator_id=excluded.creator_id,paid_by=excluded.paid_by,amount_cents=excluded.amount_cents,expense_date=excluded.expense_date,settled=excluded.settled,entry=excluded.entry,created_at=excluded.created_at,updated_at=excluded.updated_at returning *`,[snapshot]);
  await direct({...row,updated_at:new Date().toISOString(),entry:{...row.entry,paidBack:{[ids.alice]:true}}});
  await login(ids.carol);
  await direct({...row,entry:{...row.entry,paidBack:{[ids.carol]:true}}});
  const compat = await scalar(`select to_jsonb(e) from public.expenses e where id='compat'`);
  assert.deepEqual(compat.entry.paidBack,{[ids.alice]:true,[ids.carol]:true},'stale whole-row payment snapshots merge atomically');
  assert.equal(compat.settled,true);
  const beforeNoop=compat.version;
  assert.equal((await direct({...row,entry:{...row.entry,title:'Stale replacement'}})).rows.length,0,'stale snapshots without new facts skip UPDATE/Realtime');
  assert.equal(await scalar(`select version::int from public.expenses where id='compat'`),beforeNoop,'no-op legacy snapshots do not bump version');
  assert.equal(await scalar(`select entry->>'title' from public.expenses where id='compat'`),'Shared bill','stale snapshot never overwrites fields');
  await assert.rejects(direct({...compat,updated_at:'2099-01-01T00:00:00Z',entry:{...compat.entry,title:'Unauthorized'}}),/creator/);
  await assert.rejects(db.query(`delete from public.expenses where id='compat'`),/Upgrade/);
  await login(ids.alice);
  await assert.rejects(direct({...compat,updated_at:'2099-01-01T00:00:00Z',entry:{...compat.entry,title:'Even creator must upgrade'}}),/Upgrade/);
  await direct({...row,id:'legacy-new',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),entry:{...row.entry,id:'legacy-new'}});
  assert.equal(await scalar(`select version::int from public.expenses where id='legacy-new'`),1,'fresh legacy creates remain supported');
  await assert.rejects(direct({...compat,updated_at:'2099-01-01T00:00:00Z',amount_cents:600,entry:{...compat.entry,amountCents:600,allocations:compat.entry.allocations.map(a=>({...a,amountCents:200}))}}),/locked/);
  await assert.rejects(direct({...row,id:'bill'}),/deleted/,'legacy bootstrap cannot resurrect a tombstone');
  await assert.rejects(direct({...row,id:'old-cache',created_at:'2020-01-01T00:00:00Z'}),/Historical cache/);
  await assert.rejects(db.query('delete from public.expense_tombstones'),/permission denied/);
  await assert.rejects(db.query('select * from public.expense_shopping_claims'),/permission denied/);
  await assert.rejects(db.query('select * from public.expense_operation_receipts'),/permission denied/);
  await assert.rejects(db.query('select * from public.expense_legacy_correction_barriers'),/permission denied/);
  await assert.rejects(db.query(`select public.guard_legacy_expense_write('INSERT',null::public.expenses,null::public.expenses)`),/permission denied/);
  // Corrections are protected from old snapshots without trusting timestamps.
  const correctionSource=(await rpc('create','compat-correction',expensePayload())).expense;
  const acknowledged=(await rpc('repay','compat-correction')).expense;
  const corrected=(await rpc('undo_repay','compat-correction')).expense;
  await assert.rejects(direct({...acknowledged,updated_at:'2099-01-01T00:00:00Z'}),/updated app.*correction/,'old paid=true cannot reverse explicit undo');
  const intentionalNew=(await rpc('repay','compat-correction')).expense;
  assert.equal(intentionalNew.entry.paidBack[ids.alice],true,'new explicit repayment can follow undo');
  await rpc('undo_repay','compat-correction');
  const toSettle=(await scalar(`select to_jsonb(e) from public.expenses e where id='compat-correction'`));
  const manualRecord=(await rpc('settle','compat-correction',{},toSettle.version)).expense;
  const openRecord=(await rpc('reopen','compat-correction',{},manualRecord.version)).expense;
  await assert.rejects(direct({...manualRecord,entry:{...openRecord.entry,settled:true},settled:true,updated_at:'2099-01-01T00:00:00Z'}),/updated app.*reopening/,'old settled=true cannot reverse reopen');
  assert.equal((await rpc('settle','compat-correction',{},openRecord.version)).expense.entry.manuallySettled,true,'new explicit settle can follow reopen');
  // Spoofing the transaction-local marker does not create a pending receipt.
  await db.query(`select set_config('sweetmate.expense_operation',$1,false)`,[repaymentOp]);
  await assert.rejects(db.query(`delete from public.expenses where id='compat'`),/Upgrade/);
  // The actual authorized household-delete RPC must retain FK cleanup, while
  // direct expense DELETE and non-owner household destruction stay forbidden.
  const cleanupHome='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  await db.exec('reset role;');
  await db.query(`insert into public.households(id,name,invite_code,created_by) values($1,'Cleanup','CLEAN001',$2)`,[cleanupHome,ids.owner]);
  for(const user of ['owner','alice','bob','carol','former']) await db.query(`insert into public.household_members(household_id,user_id,display_name,role,status) values($1,$2,$3,$4,$5)`,[cleanupHome,ids[user],user,user==='owner'||user==='former'?'owner':'member',user==='former'?'left':'active']);
  await db.query(`insert into public.shopping_lists(id,household_id,name,sort_order,entry) values('cleanup-list',$1,'Cleanup',0,'{}')`,[cleanupHome]);
  await db.query(`insert into public.shopping_items(id,household_id,list_id,name,sort_order,entry) values('cleanup-item',$1,'cleanup-list','Cleanup item',0,'{"price":3}')`,[cleanupHome]);
  await login(ids.alice);
  const cleanupRpc=(action,id,payload={},version=null)=>scalar('select public.mutate_expense($1,$2,$3,$4,$5,$6)',[cleanupHome,operationId(),action,id,payload,version]);
  await cleanupRpc('create','cleanup-expense',expensePayload({shoppingSource:{type:'shopping-item',householdId:cleanupHome,shoppingListId:'cleanup-list',shoppingItemIds:['cleanup-item']}}));
  await cleanupRpc('repay','cleanup-expense');await cleanupRpc('undo_repay','cleanup-expense');
  const cleanupDeleted=await cleanupRpc('create','cleanup-tombstone',expensePayload());await cleanupRpc('delete','cleanup-tombstone',{},cleanupDeleted.expense.version);
  await login(ids.carol);await assert.rejects(db.query('select public.delete_household($1)',[cleanupHome]),/active household owner/);
  await login(ids.former);await assert.rejects(db.query('select public.delete_household($1)',[cleanupHome]),/active household owner/);
  await login(ids.owner);await db.query('select public.delete_household($1)',[cleanupHome]);
  await db.exec('reset role;');
  for(const table of ['households','expenses','shopping_lists','shopping_items','expense_shopping_claims','expense_operation_receipts','expense_tombstones','expense_legacy_correction_barriers']) {
    const key=table==='households'?'id':'household_id';
    assert.equal(await scalar(`select count(*)::int from public.${table} where ${key}=$1`,[cleanupHome]),0,`household RPC cascades ${table}`);
  }
  console.log('PASS: real expense migration, role matrix, canonical cents/date validation, identity/version checks, atomic actor repayment/corrections, manual settlement, durable deletion/idempotency, historical/current shopping claims and legacy snapshot compatibility.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { PGlite } = await import(process.argv[2] || '@electric-sql/pglite');
  const db = new PGlite(); try { await runExpenseDatabaseTests(db); } finally { await db.close(); }
  console.log('Use test-concurrency.mjs for true multi-session PostgreSQL contention.');
}
