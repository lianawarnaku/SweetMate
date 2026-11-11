import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {runExpensePaymentsDatabaseTests} from '../expenses/test-payments-database.mjs';
import {ids,runExpenseDatabaseTests} from '../expenses/test-database.mjs';

export async function runAccountDeletionDatabaseTests(db){
 await runExpenseDatabaseTests(db);
 await runExpensePaymentsDatabaseTests(db);
 await db.exec(`reset role;set request.jwt.claim.sub='';
 create table public.feedback(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id) on delete set null,message text);
 create table public.nudges(id uuid primary key default gen_random_uuid(),household_id uuid references public.households(id) on delete cascade,sent_by uuid references auth.users(id) on delete set null,to_member_id uuid references auth.users(id) on delete cascade);
 create table public.private_borrow_items(id text primary key,household_id uuid references public.households(id) on delete cascade,owner_id uuid references auth.users(id) on delete cascade,entry jsonb);
 create table public.push_devices(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id) on delete cascade);
 create table public.google_calendar_connections(user_id uuid primary key references auth.users(id) on delete cascade,refresh_token text);
 `);
 await db.exec(await readFile(new URL('../../supabase/migrations/202608270003_shared_borrow_items.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../supabase/migrations/202608260001_chores_table.sql',import.meta.url),'utf8'));
 for(const migration of ['202607230002_deterministic_chore_foundation','202607230003_chart_approval_flow','202608260002_household_timezone','202608260005_chore_materialization_floor','202611080001_chore_chart_integrity','202611100003_single_chore_obligation','202607240003_validate_borrow_transactions']){
  await db.exec(await readFile(new URL(`../../supabase/migrations/${migration}.sql`,import.meta.url),'utf8'));
 }

 await db.exec(await readFile(new URL('../../supabase/migrations/202611100004_account_deletion.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../../supabase/migrations/202611110001_deleted_borrow_names.sql',import.meta.url),'utf8'));
 const scalar=async(sql,p=[])=>Object.values((await db.query(sql,p)).rows[0])[0];
 const login=async role=>db.exec(`reset role;set role ${role};set request.jwt.claim.sub='${ids.alice}';`);
 await login('authenticated');
 await assert.rejects(db.query('select public.finalize_account_deletion($1,null)',[ids.bob]),/permission denied/);
 await assert.rejects(db.query('select public.delete_own_account()'),/Update SweetMate/);
 await assert.rejects(db.query('select * from public.deleted_member_aliases'),/permission denied/);
 await assert.rejects(db.query('insert into public.account_deletion_transactions values(txid_current())'),/permission denied/);
 await db.exec(`reset role;set request.jwt.claim.sub='';`);
 const homeCount=Number(await scalar('select count(*) from public.households'));
 const expenseTotals=await db.query('select id,amount_cents,entry from public.expenses order by id');
 await db.query(`insert into public.feedback(user_id,message) values($1,'private feedback')`,[ids.owner]);
 await db.query('insert into public.push_devices(user_id) values($1)',[ids.owner]);
 await db.query("insert into public.google_calendar_connections values($1,'private-google-token')",[ids.owner]);
 await db.query(`insert into public.private_borrow_items values('private',$1,$2,'{"private":"yes"}')`,[ids.home,ids.owner]);
 await db.query(`insert into public.shared_borrow_items(id,household_id,borrowed_from,due_date,entry) values('borrow',$1,$2,now(),$3)`,[ids.home,ids.owner,{visibility:'shared',borrowedFrom:ids.owner,ownerName:'Private owner',borrowedBy:ids.bob,borrowerName:'Private Bob',title:'Ladder'}]);
 await db.query(`insert into public.chores(id,household_id,title,assigned_to,assignment_mode,round_robin_participant_ids,due_date) values('chore',$1,'Trash',$2,'round-robin',$3,now())`,[ids.home,ids.owner,[ids.owner,ids.alice]]);
 await db.query(`insert into public.household_states(household_key,household_id,state) values('deletion-fixture',$1,$2)`,[ids.home,{roommates:[{id:ids.owner,name:'Private owner',avatarUri:'private-avatar'}, {id:ids.alice,name:'Alice'}],expenses:[{paidBy:ids.owner,splits:{[ids.owner]:1,[ids.alice]:2}}]}]);
 await db.query('insert into public.nudges(household_id,sent_by,to_member_id) values($1,$2,$3)',[ids.home,ids.owner,ids.alice]);
 await login('service_role');await db.query('select public.prepare_account_deletion($1)',[ids.owner]);
 await db.query('select public.finalize_account_deletion($1,$2)',[ids.owner,'sm_testanalytics123']);
 await db.exec(`reset role;set request.jwt.claim.sub='';`);
 assert.equal(Number(await scalar('select count(*) from auth.users where id=$1',[ids.owner])),0);
 assert.equal(Number(await scalar('select count(*) from public.households')),homeCount,'other roommates keep their households');
 assert.notEqual(await scalar('select created_by from public.households where id=$1',[ids.home]),ids.owner,'creator FK no longer cascades shared Sweet');
 for(const [table,key]of [['feedback','user_id'],['push_devices','user_id'],['google_calendar_connections','user_id'],['private_borrow_items','owner_id']])assert.equal(Number(await scalar(`select count(*) from public.${table} where ${key}=$1`,[ids.owner])),0,table);
 assert.equal(await scalar('select count(*)::int from public.nudges'),0,'sent messages removed before author IDs are cleared');
 const alias=await scalar('select id from public.deleted_member_aliases where household_id=$1',[ids.home]);assert.notEqual(alias,ids.owner);
 const state=await scalar(`select state from public.household_states where household_key='deletion-fixture'`);
 assert(!JSON.stringify(state).includes(ids.owner));assert(!JSON.stringify(state).includes('Private owner'));assert(!JSON.stringify(state).includes('private-avatar'));
 assert.equal(state.roommates[0].name,'Deleted member');assert.equal(state.expenses[0].splits[alias],1);
 const after=await db.query('select id,amount_cents from public.expenses order by id');assert.deepEqual(after.rows,expenseTotals.rows.map(({id,amount_cents})=>({id,amount_cents})),'shared money totals unchanged');
 assert.equal(await scalar(`select borrowed_from from public.shared_borrow_items where id='borrow'`),alias);
 assert.equal(await scalar(`select entry->>'ownerName' from public.shared_borrow_items where id='borrow'`),'Deleted member');
 assert.equal(await scalar(`select assigned_to from public.chores where id='chore'`),null);
 assert.equal(await scalar('select count(*)::int from public.vendor_erasure_requests'),1);
 // A stale roommate snapshot cannot put a deleted profile or original ID back.
 await db.query(`update public.household_states set state=$1 where household_key='deletion-fixture'`,[{roommates:[{id:ids.owner,name:'Private owner',email:'private@example.invalid',avatarUri:'private-avatar'}]}]);
 const stale=await scalar(`select state from public.household_states where household_key='deletion-fixture'`);assert(!JSON.stringify(stale).includes('private'));assert(!JSON.stringify(stale).includes(ids.owner));
 await login('authenticated');
 await db.exec("set sweetmate.account_deletion='true';");
 await assert.rejects(db.query("update public.expense_activity set summary='unauthorized'"),/immutable|permission denied/,'a spoofed GUC cannot bypass append-only guards');
 assert.equal((await db.query('select * from public.former_household_members where household_id=$1',[ids.home])).rows.length,1);
 await db.exec(`set request.jwt.claim.sub='${ids.other}';`);assert.equal((await db.query('select * from public.former_household_members where household_id=$1',[ids.home])).rows.length,0);
 await db.exec('reset role;');assert.equal(await scalar('select count(*)::int from public.account_deletion_transactions'),0);
 // Delete an actual payer, preserving payments and amounts atomically.
 const beforePayer=(await db.query('select id,amount_cents from public.expenses order by id')).rows;
 const bobPaid=Number(await scalar('select count(*) from public.expenses where paid_by=$1',[ids.bob]));assert(bobPaid>0);
 await db.query('select public.finalize_account_deletion($1,null)',[ids.bob]);
 assert.deepEqual((await db.query('select id,amount_cents from public.expenses order by id')).rows,beforePayer);
 assert.equal(await scalar(`select entry->>'borrowerName' from public.shared_borrow_items where id='borrow'`),'Deleted member');
 await db.query(`update public.shared_borrow_items set entry=entry||'{"ownerName":"Private owner","borrowerName":"Private Bob"}'::jsonb where id='borrow'`);
 assert(!JSON.stringify(await scalar(`select entry from public.shared_borrow_items where id='borrow'`)).includes('Private'));
 assert.equal(await scalar('select count(*)::int from auth.users where id=$1',[ids.bob]),0);
 await db.query('select public.finalize_account_deletion($1,null)',[ids.bob]); // idempotent
 // A failure anywhere in the transaction rolls ownership/data back.
 await assert.rejects(db.query('select public.finalize_account_deletion($1,$2)',[ids.alice,'invalid']),/Invalid analytics/);
 assert.equal(await scalar('select count(*)::int from auth.users where id=$1',[ids.alice]),1);
 assert.equal(await scalar('select count(*)::int from public.account_deletion_transactions'),0);
 await db.query('select public.finalize_account_deletion($1,null)',[ids.carol]);
 // The last roommate's owned Sweet and its anonymous history are removed.
 await db.query('select public.finalize_account_deletion($1,null)',[ids.alice]);
 assert.equal(await scalar('select count(*)::int from public.households where id=$1',[ids.home]),0);
 console.log('PASS: real expense ledger + deletion migration, service-only authorization, hard deletion, owner transfer, private cleanup, unchanged shared totals, isolated anonymous history and stale-profile suppression.');
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){const{PGlite}=await import(process.argv[2]||'@electric-sql/pglite');const db=new PGlite();try{await runAccountDeletionDatabaseTests(db);}finally{await db.close();}}
