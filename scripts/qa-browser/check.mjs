// Launcher smoke check with a simulated LOCAL Auth/REST backend. This is not
// an authenticated end-to-end test of Supabase or the SweetMate screens.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { cp, mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const temp=await mkdtemp(join(tmpdir(),'sweetmate-qa-launcher-'));
let app, backend;
try {
 await mkdir(resolve(temp,'scripts'),{recursive:true});
 await cp(resolve(repo,'scripts/qa-browser'),resolve(temp,'scripts/qa-browser'),{recursive:true});
 await cp(resolve(repo,'supabase'),resolve(temp,'supabase'),{recursive:true,filter:source=>!source.includes('/.temp')});
 await mkdir(resolve(temp,'mock-bin'),{recursive:true});
 await writeFile(resolve(temp,'mock-bin/npm'),`#!/usr/bin/env node\nconsole.log(JSON.stringify({API_URL:'http://127.0.0.1:54321',ANON_KEY:'qa-public-key',SERVICE_ROLE_KEY:'qa-service-key'}));\n`,{mode:0o755});
 await mkdir(resolve(temp,'web-fixture'),{recursive:true});
 await writeFile(resolve(temp,'web-fixture/index.html'),'<title>Static fixture</title><script src="/app.js"></script>');
 await writeFile(resolve(temp,'web-fixture/app.js'),'const key="SWEETMATE_QA_ANON_KEY_PLACEHOLDER";');
 const calls=[],users=[];
 backend=createServer(async(req,res)=>{
  const text=await Array.fromAsync(req).then(parts=>Buffer.concat(parts).toString());
  const body=text?JSON.parse(text):{};calls.push({path:req.url,body});
  let result;
  if(req.url==='/auth/v1/admin/users'){const user={id:users.length?'22222222-2222-4222-8222-222222222222':'11111111-1111-4111-8111-111111111111',email:body.email};users.push(user);result=user;}
  else if(req.url.startsWith('/auth/v1/token')){const user=users.find(u=>u.email===body.email);assert(user);result={user,access_token:'local-test-token',refresh_token:'local-test-refresh',expires_at:9999999999,token_type:'bearer'};}
  else if(req.url==='/rest/v1/rpc/create_household'){assert.equal(body.household_name,'QA Sweet 1');result=[{household_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}];}
  else if(req.url==='/rest/v1/rpc/join_household')result='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  else if(req.url==='/rest/v1/household_preferences')result=null;
  else {res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
 });
 await new Promise((done,reject)=>{backend.once('error',reject);backend.listen(54321,'127.0.0.1',done)});
 let output='';
 app=spawn(process.execPath,[resolve(temp,'scripts/qa-browser/start.mjs')],{cwd:temp,env:{...process.env,PATH:resolve(temp,'mock-bin')+':'+process.env.PATH,SWEETMATE_QA_REUSE_BACKEND:'1',SWEETMATE_QA_WEB_DIR:resolve(temp,'web-fixture'),SWEETMATE_QA_NO_OPEN:'1'},stdio:['ignore','pipe','pipe']});
 app.stdout.on('data',d=>output+=d);app.stderr.on('data',d=>output+=d);
 await new Promise((done,reject)=>{
  const deadline=setTimeout(()=>{clearInterval(poll);reject(new Error('Launcher readiness timeout: '+output))},20000);
  const poll=setInterval(()=>{if(output.includes('Ready: http://127.0.0.1:4172')){clearTimeout(deadline);clearInterval(poll);done()}else if(app.exitCode!==null){clearTimeout(deadline);clearInterval(poll);reject(new Error(output))}},100);
 });
 const launcher=await fetch('http://127.0.0.1:4172').then(r=>r.text());assert(launcher.includes('4173/qa-login'));assert(launcher.includes('4174/qa-login'));assert(launcher.includes('qa-sync-status'));assert(launcher.includes('/qa/version'));
 const a=await fetch('http://127.0.0.1:4173/qa/session').then(r=>r.json());
 const b=await fetch('http://127.0.0.1:4174/qa/session').then(r=>r.json());
 assert.notEqual(a.session.user.id,b.session.user.id);assert.equal(a.householdId,b.householdId);
 assert.equal(a.session.user.email,'avery@sweetmate.test');assert.equal(b.session.user.email,'blake@sweetmate.test');
 const version=await fetch('http://127.0.0.1:4173/qa/version').then(r=>r.json());assert.equal(version.sha,'fixture');assert.equal(version.message,'Up to date');
 const login=await fetch('http://127.0.0.1:4173/qa-login').then(r=>r.text());assert(login.includes('sb-127-auth-token'));
 const js=await fetch('http://127.0.0.1:4173/app.js').then(r=>r.text());assert(js.includes('qa-public-key'));assert(!js.includes('qa-service-key'));assert(!js.includes('PLACEHOLDER'));
 assert.equal((await fetch('http://127.0.0.1:4173/qa/session',{headers:{Origin:'https://unrelated.example'}})).status,403);
 assert.equal((await fetch('http://127.0.0.1:4173/missing.js')).status,404);
 assert.equal((await fetch('http://127.0.0.1:4172/walkthrough')).status,200);
 assert.equal(users.length,2);assert.equal(calls.filter(c=>c.path==='/rest/v1/rpc/create_household').length,1);
 console.log('PASS: local fixture requests, separate persona sessions, shared QA household, three servers, public-key-only assets, login page, checklist and origin restriction.');
} finally {
 if(app && app.exitCode===null){app.kill('SIGTERM');await new Promise(done=>app.once('exit',done));}
 if(backend)await new Promise(done=>backend.close(done));
 await rm(temp,{recursive:true,force:true});
}
