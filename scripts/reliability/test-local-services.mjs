// Real local Auth, PostgREST and Realtime, using fresh disposable accounts only.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname,'../..');
const cli = root+'/node_modules/.pnpm/@supabase+cli-darwin-arm64@2.109.1/node_modules/@supabase/cli-darwin-arm64/bin/supabase';
const backend = process.env.SWEETMATE_QA_BACKEND || '/Users/lianawarnakulasooriya/Downloads/SweetMate-codex-qa-browser-preview/.sweetmate-qa/backend';
const raw = execFileSync(cli,['status','--workdir',backend,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
const config = JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));
assert.equal(config.API_URL,'http://127.0.0.1:54321','Refusing a non-local backend');
const {createClient} = createRequire(root+'/artifacts/mobile/package.json')('@supabase/supabase-js');
const users=[], sdkClients=[];
const key=config.ANON_KEY, admin=config.SERVICE_ROLE_KEY;
async function request(path,token,body,method='POST',allowError=false,extra={}) {
 const response=await fetch(config.API_URL+path,{method,headers:{apikey:key,Authorization:'Bearer '+token,'Content-Type':'application/json','x-sweetmate-chore-policy':'single-obligation-v1',...extra},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
 const text=await response.text(); let data; try{data=text?JSON.parse(text):null;}catch{throw Error('Local service returned non-JSON');}
 if(!response.ok&&!allowError)throw Error(path.split('?')[0]+' HTTP '+response.status);
 return {status:response.status,data};
}
const get=(path,token)=>request(path,token,undefined,'GET');
try {
 for(const label of ['owner','member']) {
  const email='reliability-'+label+'-'+randomUUID()+'@sweetmate.local', password=randomBytes(24).toString('base64url');
  const created=await request('/auth/v1/admin/users',admin,{email,password,email_confirm:true});
  const user={id:created.data.id,email,password}; users.push(user);
  user.session=(await request('/auth/v1/token?grant_type=password',key,{email,password})).data;
 }
 const [a,b]=users, invite=randomBytes(4).toString('hex').toUpperCase();
 const createdHome=(await request('/rest/v1/rpc/create_household',a.session.access_token,{household_name:'Disposable service reliability home',member_name:'Disposable A',member_color:'#888888',requested_invite_code:invite,household_timezone:'America/New_York'})).data[0]; const home=createdHome.household_id; const currentInvite=createdHome.invite_code;
 await request('/rest/v1/rpc/join_household',b.session.access_token,{code:currentInvite,member_name:'Disposable B',member_color:'#999999'});
 const client=createClient(config.API_URL,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}); sdkClients.push(client);
 await client.auth.setSession(b.session);
 const id='reliability-service-'+randomUUID(), events=[], membershipEvents=[];
 const channel=client.channel('reliability:'+randomUUID()).on('postgres_changes',{event:'*',schema:'public',table:'shopping_lists'},payload=>{if((payload.new.id||payload.old.id)===id)events.push(payload.eventType);}).on('postgres_changes',{event:'UPDATE',schema:'public',table:'household_members',filter:'user_id=eq.'+b.id},payload=>{if(payload.new.household_id===home)membershipEvents.push(payload.new.status);});
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Local Realtime did not subscribe')),12000);
  channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}else if(['CHANNEL_ERROR','TIMED_OUT'].includes(status)){clearTimeout(timer);reject(Error(status));}});
 });
 const list={id,household_id:home,name:'Disposable shared list',sort_order:0,entry:{id,name:'Disposable shared list'}};
 const waitEvent=async expected=>{const deadline=Date.now()+12000;while(!events.includes(expected)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,30));assert(events.includes(expected),'Missing Realtime '+expected);};
 await request('/rest/v1/shopping_lists',a.session.access_token,list);
 await waitEvent('INSERT');
 await request('/rest/v1/shopping_lists?id=eq.'+id,a.session.access_token,{name:'Updated disposable list',entry:{id,name:'Updated disposable list'}},'PATCH');
 await waitEvent('UPDATE');
 assert.equal((await get('/rest/v1/shopping_lists?id=eq.'+id,b.session.access_token)).data[0].name,'Updated disposable list');
 await request('/rest/v1/shopping_lists?id=eq.'+id,a.session.access_token,undefined,'DELETE');
 await waitEvent('DELETE');
 assert.deepEqual(events,['INSERT','UPDATE','DELETE'],'real peer must receive each list event, including primary-key-only DELETE');
 assert.equal((await get('/rest/v1/shopping_lists?id=eq.'+id,b.session.access_token)).data.length,0);
 console.log('PASS authenticated two-client REST persistence and actual Realtime insert/update/delete delivery');
 await request('/rest/v1/shopping_lists',a.session.access_token,list);
 const blocked=await request('/rest/v1/rpc/leave_household',a.session.access_token,{target_household_id:home},'POST',true);
 assert(blocked.status>=400); assert.match(blocked.data.message,/Transfer ownership/);
 await request('/rest/v1/rpc/remove_household_member',a.session.access_token,{target_household_id:home,target_user_id:b.id});
 const revocationDeadline=Date.now()+12000;
 while(!membershipEvents.includes('removed')&&Date.now()<revocationDeadline)await new Promise(resolve=>setTimeout(resolve,30));
 assert(membershipEvents.includes('removed'),'removed member must receive their own Realtime revocation');
 const ownMembership=(await get('/rest/v1/household_members?household_id=eq.'+home,b.session.access_token)).data;
 assert.equal(ownMembership.length,1); assert.equal(ownMembership[0].user_id,b.id); assert.equal(ownMembership[0].status,'removed');
 console.log('PASS real Realtime revocation reaches the removed member without exposing other memberships');
 assert.equal((await get('/rest/v1/shopping_lists?id=eq.'+id,b.session.access_token)).data.length,0);
 assert.equal((await get('/auth/v1/user',b.session.access_token)).data.id,b.id,'removal must not delete the account');
 await request('/rest/v1/rpc/create_household_reinvitation',a.session.access_token,{target_household_id:home,target_user_id:b.id});
 const freshInvite=(await request('/rest/v1/households?id=eq.'+home+'&select=invite_code',a.session.access_token)).data[0].invite_code;
 await request('/rest/v1/rpc/join_household',b.session.access_token,{code:freshInvite,member_name:'Disposable B',member_color:'#999999'});
 assert.equal((await get('/rest/v1/shopping_lists?id=eq.'+id,b.session.access_token)).data.length,1);
 console.log('PASS real JWT membership removal, immediate access denial, account preservation, and rejoining');
 await request('/rest/v1/rpc/finalize_account_deletion',admin,{target_user_id:a.id,analytics_id:null});
 const deleted=await request('/auth/v1/user',a.session.access_token,undefined,'GET',true);
 assert([401,403].includes(deleted.status),'deleted account must not resolve through its former JWT');
 assert.equal((await get('/rest/v1/shopping_lists?id=eq.'+id,a.session.access_token)).data.length,0);
 assert.equal((await get('/rest/v1/shopping_lists?id=eq.'+id,b.session.access_token)).data.length,1);
 assert.equal((await get('/rest/v1/household_members?household_id=eq.'+home+'&user_id=eq.'+b.id,b.session.access_token)).data[0].role,'owner');
 console.log('PASS real Auth user deletion, old-token data denial, surviving roommate records and ownership');
} finally {
 for(const client of sdkClients) { await client.removeAllChannels(); await client.realtime.disconnect(); }
 for(const user of users) {
  assert(user.email.endsWith('@sweetmate.local'));
  const result=await request('/rest/v1/rpc/finalize_account_deletion',admin,{target_user_id:user.id,analytics_id:null},'POST',true);
  if(result.status>=400)throw Error('Disposable local account cleanup failed');
 }
}
