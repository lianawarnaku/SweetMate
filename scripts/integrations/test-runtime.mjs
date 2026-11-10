import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const ts=createRequire(root+'/artifacts/mobile/package.json')('typescript');
function load(name){
 const exports={};
 const js=ts.transpileModule(readFileSync(root+'/supabase/functions/_shared/'+name+'.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 runInNewContext(js,{exports,Date,URLSearchParams,TextEncoder,Uint8Array,crypto:webcrypto,AbortSignal,fetch});
 return exports;
}
const {deliveryOutcome,processNudgePush}=load('nudge-push');
assert.equal(deliveryOutcome({status:'ok',id:'ticket'},false,1).state,'receipt');
assert.equal(deliveryOutcome({status:'ok'},true,2).state,'delivered');
assert.equal(deliveryOutcome(undefined,true,2).state,'receipt');
assert.equal(deliveryOutcome(undefined,false,1).state,'pending');
assert.equal(deliveryOutcome(undefined,false,6).state,'failed');
for(const receipt of [false,true]){
 const outcome=deliveryOutcome({status:'error',details:{error:'DeviceNotRegistered'}},receipt,1);
 assert.equal(outcome.state,'failed');assert.equal(outcome.disable,true);
}
const writes=[];
const admin={rpc:async()=>({data:[{id:'job',nudge_id:'nudge',recipient_id:'recipient',device_id:'device',expo_token:'test-token',claim_id:'lease',state:'pending',attempts:1}],error:null}),from:table=>({update:values=>{const filters=[];const query={eq:(key,value)=>{filters.push([key,value]);return query},then:done=>{writes.push({table,values,filters});return Promise.resolve({error:null}).then(done)}};return query}})};
await processNudgePush(admin,undefined,async(url,init)=>{
 const messages=JSON.parse(init.body);assert.equal(messages[0].to,'test-token');assert.equal(messages[0].data.nudgeId,'nudge');
 assert(!JSON.stringify(messages).includes('sender'));return {ok:true,json:async()=>({data:[{status:'ok',id:'ticket'}]})};
});
assert.equal(writes[0].values.state,'receipt');assert(writes[0].filters.some(([k,v])=>k==='claim_id'&&v==='lease'));
const {calendarEvent,createCalendarService}=load('calendar');
const input={choreId:'one',title:'Dishes',dueDate:'2026-12-31',points:100};
const event=await calendarEvent(input);
assert.equal(event.end.date,'2027-01-01');assert.equal(event.id,(await calendarEvent(input)).id);assert(!event.description.includes('Points'));
await assert.rejects(()=>calendarEvent({...input,dueDate:'2026-02-31'}));
function calendarDb(row){const writes=[];return {writes,from:table=>{
 const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:row,error:null}),upsert:async data=>{writes.push(data);return {error:null}},update:()=>q,delete:()=>q,then:done=>Promise.resolve({error:null}).then(done)};return q;
}}}
const row={refresh_token:'refresh',access_token:'cached',access_token_expires_at:new Date(Date.now()+3600000).toISOString()};
let refreshes=0;
const network=async(url,init)=>{
 if(url.includes('/token')){refreshes++;return {ok:true,json:async()=>({access_token:'fresh',expires_in:3600,scope:'https://www.googleapis.com/auth/calendar.events'})}}
 if(url.includes('/userinfo'))return {ok:true,json:async()=>({sub:'google-me'})};
 assert.equal(init.headers.Authorization,'Bearer cached');return {ok:false,status:409};
};
const db=calendarDb(row);
const service=createCalendarService(db,{clientId:'client',clientSecret:'secret'},network);
assert.equal((await service.add('me',input)).alreadyAdded,true);
assert.equal(refreshes,0);
await service.connect({id:'me',identities:[{provider:'google',identity_data:{sub:'google-me'}}]},{refreshToken:'fresh-refresh'});
assert.equal(db.writes.length,1);assert.equal(db.writes[0].user_id,'me');
await assert.rejects(()=>service.connect({id:'other',identities:[{provider:'google',identity_data:{sub:'google-other'}}]},{refreshToken:'refresh'}),e=>e.code==='GOOGLE_ACCOUNT_MISMATCH');
assert.equal(db.writes.length,1);
const missingScope=createCalendarService(db,{clientId:'c',clientSecret:'s'},async()=>({ok:true,json:async()=>({access_token:'token',scope:'openid email'})}));
await assert.rejects(()=>missingScope.connect({id:'me'},{refreshToken:'refresh'}),e=>e.code==='GOOGLE_PERMISSION_DENIED');
const expired=createCalendarService(calendarDb({...row,access_token_expires_at:'2020-01-01'}),{clientId:'c',clientSecret:'s'},async()=>({ok:false,status:400}));
assert.equal((await expired.status('me')).reconnectRequired,true);
const disconnected=createCalendarService(calendarDb(null),{},network);
assert.equal((await disconnected.status('me')).connected,false);
await assert.rejects(()=>disconnected.add('me',input),e=>e.code==='GOOGLE_RECONNECT_REQUIRED');
console.log('Integration runtime tests passed: push retries/receipts, recipient payload, leases, Calendar identity/scope, expiry and duplicate events.');
