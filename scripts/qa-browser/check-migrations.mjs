// Replay migration SQL in a disposable PostgreSQL-WASM database. The actual
// Supabase Auth/API/Realtime services and cron/net extensions are not tested.
// Usage: node scripts/qa-browser/check-migrations.mjs /path/to/pglite/dist/index.js [supabase/tests/example.sql ...]
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
if(!process.argv[2])throw new Error('Pass the absolute PGlite module path.');
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2])).href);
const source=await readFile(resolve(root,'scripts/qa-browser/start.mjs'),'utf8');
const start=source.indexOf('function prepareMigration('),end=source.indexOf('async function copySchema()',start);
assert(start>=0&&end>start);
const context={};runInNewContext(source.slice(start,end)+';this.prepare=prepareMigration;',context);
const grantsStart=source.indexOf('function localQAGrants()'),grantsEnd=source.indexOf('async function applyLocalQAGrants()',grantsStart);
assert(grantsStart>=0&&grantsEnd>grantsStart);
runInNewContext(source.slice(grantsStart,grantsEnd)+';this.grants=localQAGrants;',context);
const name='202607220004_add_household_member_color.sql';
const original=await readFile(resolve(root,'supabase/migrations',name),'utf8');
const prepared=context.prepare(name,original);
assert.notEqual(prepared,original);assert.equal(context.prepare(name,prepared),prepared);
assert.equal(context.prepare('unrelated.sql',original),original);
// The old-column path must preserve custom colors, while a genuinely fresh
// table must use the default without referring to a nonexistent column.
for(const legacy of [false,true]){
 const db=new PGlite();
 await db.exec(`create table household_members(id integer, color text${legacy?', avatar_color text':''});`);
 if(legacy)await db.exec(`insert into household_members values(1,null,'#123456'),(2,'#abcdef','#000000'),(3,null,null);`);
 else await db.exec(`insert into household_members values(1,null),(2,'#abcdef');`);
 if(!legacy)await assert.rejects(()=>db.exec(original),/avatar_color/);
 await db.exec(prepared);
 const rows=(await db.query('select color from household_members order by id')).rows;
 assert.equal(rows[0].color,legacy?'#123456':'#7B563B');assert.equal(rows[1].color,'#abcdef');
 if(legacy)assert.equal(rows[2].color,'#7B563B');
 await db.exec(prepared);await db.close();
}
function splitSQL(sql) {
 const result=[];let start=0,i=0,quote='',dollar='',block=0,line=false;
 while(i<sql.length){
  const c=sql[i],next=sql[i+1];
  if(line){if(c==='\n')line=false;i++;continue;}
  if(block){if(c==='/'&&next==='*'){block++;i+=2;}else if(c==='*'&&next==='/'){block--;i+=2;}else i++;continue;}
  if(dollar){if(sql.startsWith(dollar,i)){i+=dollar.length;dollar='';}else i++;continue;}
  if(quote){if(c===quote&&next===quote){i+=2;continue;}if(c===quote)quote='';else if(c==='\\')i++;i++;continue;}
  if(c==='-'&&next==='-'){line=true;i+=2;continue;}
  if(c==='/'&&next==='*'){block=1;i+=2;continue;}
  if(c==="'"||c==='"'){quote=c;i++;continue;}
  if(c==='$'){const match=/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.exec(sql.slice(i));if(match){dollar=match[0];i+=dollar.length;continue;}}
  if(c===';'){const part=sql.slice(start,i+1).trim();if(part)result.push(part);start=i+1;}
  i++;
 }
 const trailing=sql.slice(start).trim();if(trailing&&!/^--[^\n]*$/.test(trailing))result.push(trailing);
 assert(!quote&&!dollar&&!block,'unterminated SQL quote/comment');return result;
}
assert.equal(splitSQL("select ';'; /* comment; */ select $$begin;end;$$; -- comment;\nselect 1;").length,3);
const lockName='202611080003_expense_payments_activity.sql';
const lockOriginal=await readFile(resolve(root,'supabase/migrations',lockName),'utf8');
const lockPrepared=context.prepare(lockName,lockOriginal);
assert.match(lockPrepared,/^begin;/);assert.match(lockPrepared,/commit;\s*$/);
assert.equal(context.prepare(lockName,lockPrepared),lockPrepared,'explicit transactions must not be nested');
const transactionCheck=new PGlite();
await transactionCheck.exec('create table expenses(id integer);');
await assert.rejects(()=>transactionCheck.exec('lock table expenses in access exclusive mode;'),/transaction blocks/);
for(const statement of splitSQL(context.prepare('fixture.sql','lock table expenses in access exclusive mode;')))await transactionCheck.exec(statement);
await transactionCheck.close();
const db=new PGlite();
try{
 await db.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema extensions;create schema cron;create schema vault;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb,created_at timestamptz default now());
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select current_setting('role',true)$$;
 grant usage on schema auth to anon,authenticated;grant execute on function auth.uid(),auth.role() to anon,authenticated;
 create publication supabase_realtime;
 create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
 create view vault.decrypted_secrets as select null::text as name,null::text as decrypted_secret where false;
 `);
 const names=(await readdir(resolve(root,'supabase/migrations'))).filter(n=>n.endsWith('.sql')).sort();
 for(const n of names){
  let sql=context.prepare(n,await readFile(resolve(root,'supabase/migrations',n),'utf8'));
  // PGlite has no Supabase extension binaries. Leave the functions/policies
  // intact; only extension loading and actual scheduling are substituted.
  sql=sql.replace(/create extension if not exists (pgcrypto|pg_cron|pg_net)(?: with schema \w+)?;/gi,'');
  try{for(const statement of splitSQL(sql))await db.exec(statement);}catch(error){console.error('FAILED migration:',n);throw error;}
 }
 // Verify real role behavior after full SQL replay, not just table creation.
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',outsider='33333333-3333-4333-8333-333333333333';
 await db.query('insert into auth.users(id) values($1),($2),($3)',[a,b,outsider]);
 const login=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 await login(a);
 await assert.rejects(()=>db.query('select * from public.household_preferences'),/permission denied/);
 const created=await db.query("select * from public.create_household('QA Sweet 1','Avery','#5793d6','QA123456','America/New_York')");
 const hid=created.rows[0].household_id;
 await login(b);await db.query("select public.join_household('QA123456','Blake','#b58ad0')");
 await db.exec('reset role');await db.exec(context.grants());await db.exec(context.grants());
 await login(a);
 await db.query('insert into public.household_preferences(household_id,household_complete,updated_by) values($1,true,$2)',[hid,a]);
 assert.equal((await db.query('select * from public.household_members')).rows.length,2);
 assert.equal((await db.query('select household_complete from public.household_preferences')).rows[0].household_complete,true);
 // An authenticated member can create/read chores and shopping; outsiders cannot.
 await db.exec(`set request.headers='{"x-sweetmate-chore-policy":"single-obligation-v1"}';`);
 await db.query("insert into public.chores(id,household_id,title,creator_id,assigned_to,due_date,scheduled_date) values('qa-chore',$1,'QA — wash dishes',$2,$2,'2026-11-18T23:59:00Z','2026-11-18')",[hid,a]);
 await db.query("insert into public.shopping_lists(id,household_id,name,sort_order,entry) values('qa-list',$1,'QA shopping',0,'{}')",[hid]);
 await db.query("insert into public.private_borrow_items(id,household_id,owner_id,entry) values(gen_random_uuid(),$1,$2,$3)",[hid,a,JSON.stringify({visibility:'private',householdId:hid,creatorId:a,ownerId:a})]);
 await login(b);
 assert.equal((await db.query('select * from public.chores')).rows.length,1);
 assert.equal((await db.query('select * from public.shopping_lists')).rows.length,1);
 assert.equal((await db.query('select * from public.private_borrow_items')).rows.length,0);
 await assert.rejects(()=>db.query("update public.household_members set role='owner' where user_id=$1",[b]),/permission denied/);
 await assert.rejects(()=>db.query('select sent_by from public.nudges'),/permission denied/);
 for(const table of ['google_calendar_connections','push_devices','nudge_push_deliveries','expense_operation_receipts','expense_shopping_claims','deleted_member_aliases','vendor_erasure_requests']){
   await assert.rejects(()=>db.query(`select * from public.${table}`),/permission denied/);
 }
 await assert.rejects(()=>db.query('insert into public.proposed_charts(household_id,created_by) values($1,$2)',[hid,b]),/permission denied/);
 await login(outsider);
 for(const table of ['households','household_members','household_preferences','chores','shopping_lists'])assert.equal((await db.query(`select * from public.${table}`)).rows.length,0);
 await assert.rejects(()=>db.query('insert into public.household_preferences(household_id,updated_by) values($1,$2)',[hid,outsider]),/row-level security/);
 console.log('PASS: reproduced missing table grants; real owner/member fixture creation, preferences/chore/shopping access, private-record isolation, outsider RLS and protected column/service-table restrictions.');
 console.log(`PASS: fresh and legacy color migration paths; ${names.length} ordered migrations replayed statement-by-statement with explicit transaction boundaries (extension loading/scheduling substituted).`);
 for(const test of process.argv.slice(3)) {
   await db.exec("reset role; select set_config('request.jwt.claim.sub','',false);");
   await db.exec(await readFile(resolve(root,test),'utf8'));
   console.log('PASS SQL regression:',test);
 }
}finally{await db.close();}
