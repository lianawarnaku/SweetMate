import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const ts=createRequire(root+'/artifacts/mobile/package.json')('typescript');
const code=readFileSync(root+'/supabase/functions/_shared/account-deletion.ts','utf8');
const exports={};
runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,URLSearchParams,AbortSignal,atob,fetch});
const {executeAccountDeletion}=exports;
const appleUser={id:'me',identities:[{provider:'apple',identity_data:{sub:'apple-me'}}]};
const token=(sub='apple-me')=>'header.'+Buffer.from(JSON.stringify({sub,aud:'client',iss:'https://appleid.apple.com'})).toString('base64url')+'.signature';
function fixture(patch={}){
 const calls=[];const dep={config:{appleClientId:'client',appleClientSecret:'private-test-only'},
 preflight:async id=>calls.push(['preflight',id]),disconnectGoogle:async id=>calls.push(['google',id]),finalize:async(id,a)=>calls.push(['delete',id,a]),
 request:async(url,init)=>{calls.push([url,Object.fromEntries(init.body)]);return {ok:true,json:async()=>({id_token:token()})}},...patch};return {calls,dep};
}
let f=fixture();await executeAccountDeletion({id:'email-user'}, {},f.dep);
assert.deepEqual(f.calls.map(c=>c[0]),['preflight','google','delete']);
f=fixture();await executeAccountDeletion(appleUser,{appleRefreshToken:'apple-refresh',analyticsId:'sm_abcdefgh123'},f.dep);
assert.deepEqual(f.calls.map(c=>c[0]),['preflight','https://appleid.apple.com/auth/token','https://appleid.apple.com/auth/revoke','google','delete']);
assert.equal(f.calls.at(-1)[1],'me');assert.equal(f.calls[2][1].token_type_hint,'refresh_token');
for(const body of [{userId:'someone-else'},{analyticsId:'invalid'},null]){
 f=fixture();await assert.rejects(()=>executeAccountDeletion(appleUser,body,f.dep));assert.equal(f.calls.length,0);
}
f=fixture({config:{}});await assert.rejects(()=>executeAccountDeletion(appleUser,{appleRefreshToken:'r'},f.dep),e=>e.code==='APPLE_NOT_CONFIGURED');assert(!f.calls.some(c=>c[0]==='delete'));
f=fixture();await assert.rejects(()=>executeAccountDeletion(appleUser,{},f.dep),e=>e.code==='APPLE_REAUTH_REQUIRED');assert(!f.calls.some(c=>c[0]==='delete'));
f=fixture({request:async()=>({ok:true,json:async()=>({id_token:token('wrong-account')})})});await assert.rejects(()=>executeAccountDeletion(appleUser,{appleRefreshToken:'r'},f.dep),e=>e.code==='APPLE_ACCOUNT_MISMATCH');assert(!f.calls.some(c=>c[0]==='delete'));
for(const failure of ['preflight','token','revoke','google']){
 f=fixture();if(failure==='preflight')f.dep.preflight=async()=>{throw Error('db unavailable')};
 if(failure==='google')f.dep.disconnectGoogle=async()=>{throw Error('provider unavailable')};
 if(['token','revoke'].includes(failure))f.dep.request=async url=>({ok:!url.endsWith('/'+failure),json:async()=>({id_token:token()})});
 await assert.rejects(()=>executeAccountDeletion(appleUser,{appleRefreshToken:'r'},f.dep));assert(!f.calls.some(c=>c[0]==='delete'),failure+' must not delete the user');
}
console.log('PASS: authenticated account identity, Apple token binding/revocation ordering, cancellation/configuration/provider failures cannot delete an account.');
