// Exercise the actual updater's Git sync against an isolated local remote.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const temp=await mkdtemp(join(tmpdir(),'sweetmate-qa-sync-'));
function git(args) {
 const result=spawnSync('git',args,{encoding:'utf8'});
 if(result.status!==0)throw new Error(result.stderr);
 return result.stdout.trim();
}
try {
 const origin=resolve(temp,'origin.git'), author=resolve(temp,'author'), appRoot=resolve(temp,'managed-main');
 git(['init','--bare',origin]);git(['init','--initial-branch=main',author]);
 git(['-C',author,'config','user.name','Local QA fixture']);git(['-C',author,'config','user.email','qa@sweetmate.test']);
 await writeFile(resolve(author,'app.txt'),'first');git(['-C',author,'add','.']);git(['-C',author,'commit','-m','first']);git(['-C',author,'remote','add','origin',origin]);git(['-C',author,'push','-u','origin','main']);
 const source=await readFile(resolve(repo,'scripts/qa-browser/start.mjs'),'utf8');
 const start=source.indexOf('async function syncSource() {'),end=source.indexOf('async function copySchema()',start);
 assert(start>=0&&end>start);
 const ctx={process:{env:{}},existsSync,resolve,appRoot,gitUrl:origin,
  run:async(command,args)=>{assert.equal(command,'git');git(args);},
  capture:(command,args)=>{assert.equal(command,'git');return git(args);}};
 runInNewContext(source.slice(start,end)+';this.sync=syncSource;',ctx);
 const first=await ctx.sync();assert.equal(first,git(['-C',author,'rev-parse','HEAD']));
 for(const [text,message] of [['second','second'],['third','third']]){
  await writeFile(resolve(author,'app.txt'),text);git(['-C',author,'add','.']);git(['-C',author,'commit','-m',message]);
 }
 git(['-C',author,'push','origin','main']);
 const next=await ctx.sync();assert.notEqual(first,next);assert.equal(next,git(['-C',author,'rev-parse','HEAD']));
 assert.equal(await readFile(resolve(appRoot,'app.txt'),'utf8'),'third');
 assert.equal(await ctx.sync(),next,'unchanged main must remain stable');
 console.log('PASS: actual updater clones main, detects multiple pushed commits, fast-forwards its managed checkout and handles unchanged main.');
} finally {await rm(temp,{recursive:true,force:true});}
