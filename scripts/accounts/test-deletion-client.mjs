import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const ts=createRequire(root+'/artifacts/mobile/package.json')('typescript');
const code=ts.transpileModule(readFileSync(root+'/artifacts/mobile/lib/accountDeletion.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function fixture({apple=false,browser={type:'success',url:'sweetmate://auth/callback?code=test'},differentAccount=false,serverOk=true}={}){
 const original={user:{id:'me',identities:apple?[{provider:'apple'}]:[]},access_token:'session-only',refresh_token:'session-refresh'};
 let session=original;const calls=[];const removed=[];
 const storage={getItem:async()=>null,getAllKeys:async()=>['sweetmate:user:me:state','sweetmate:user:other:state','sweetmate:user-preferences:v1:me','@sweetmate/external-task/v1/me/chore','@sweetmate/external-task/v1/other/chore','unrelated'],multiRemove:async keys=>removed.push(...keys)};
 const auth={getSession:async()=>({data:{session}}),getUser:async()=>({data:{user:original.user}}),signInWithOAuth:async()=>({data:{url:'https://appleid.apple.com/authorize'}}),exchangeCodeForSession:async()=>{session={...original,user:{id:differentAccount?'other':'me'},provider_refresh_token:'apple-private'};return{data:{session}}},setSession:async()=>{session=original;calls.push('restore');return{data:{session}}}};
 const exports={};
 runInNewContext(code,{exports,process:{env:{EXPO_PUBLIC_SUPABASE_URL:'https://example.supabase.co'}},require:name=>({'@react-native-async-storage/async-storage':{default:storage},'expo-linking':{createURL:()=> 'sweetmate://auth/callback'},'expo-web-browser':{openAuthSessionAsync:async()=>browser},'./supabase':{supabase:{auth}},'./oauthCallback':{authCallbackValue:(url,key)=>new URL(url).searchParams.get(key)}}[name]),fetch:async(url,init)=>{calls.push(JSON.parse(init.body));return{ok:serverOk,json:async()=>serverOk?{deleted:true}:{error:'Please retry'}}}});
 return{...exports,calls,removed};
}
let f=fixture();await f.deleteAuthenticatedAccount();assert.equal(f.calls.length,1);assert.equal(f.calls[0].appleRefreshToken,undefined);
f=fixture({apple:true});await f.deleteAuthenticatedAccount();assert.equal(f.calls[0].appleRefreshToken,'apple-private');assert(!('userId'in f.calls[0]));
f=fixture({apple:true,browser:{type:'cancel'}});await assert.rejects(f.deleteAuthenticatedAccount,/cancelled/);assert.equal(f.calls.length,0);
f=fixture({apple:true,differentAccount:true});await assert.rejects(f.deleteAuthenticatedAccount,/linked/);assert.deepEqual(f.calls,['restore']);
f=fixture({serverOk:false});await assert.rejects(f.deleteAuthenticatedAccount,/Please retry/);assert.equal(f.removed.length,0);
f=fixture();await f.clearDeletedAccountStorage('me');assert.deepEqual(f.removed,['sweetmate:user:me:state','sweetmate:user-preferences:v1:me','@sweetmate/external-task/v1/me/chore']);
console.log('PASS: actual mobile deletion module, Apple confirmation/cancellation, wrong-account session restoration, server failure preservation, per-user device cleanup.');
