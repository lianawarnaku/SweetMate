// Replay migration SQL in a disposable PostgreSQL-WASM database. The actual
// Supabase Auth/API/Realtime services and cron/net extensions are not tested.
// Usage: node scripts/qa-browser/check-migrations.mjs /path/to/pglite/dist/index.js
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
  try{await db.exec(sql);}catch(error){console.error('FAILED migration:',n);throw error;}
 }
 console.log(`PASS: fresh and legacy color migration paths; ${names.length} ordered migrations replayed (extension loading/scheduling substituted).`);
}finally{await db.close();}
