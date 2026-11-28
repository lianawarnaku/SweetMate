import assert from "node:assert/strict";
import { ScheduleCompletionQueue } from "./scheduleCompletionQueue.ts";
import type { PersonalScheduleItem } from "./personalSchedule.ts";

const stamp = "2026-11-25T16:30:00.000Z";
const item: PersonalScheduleItem = { id: "event", user_id: "me", source: "google-event", resource_id: "calendar", provider_id: "event", title: "Private appointment",
  starts_at: null, ends_at: null, starts_on: "2026-11-25", ends_on: "2026-11-26", busy: false, link: null,
  app_completed_at: null, override_start: null, override_end: null, period_override: null };
function fixture() {
  const values = new Map<string, string | null>([["event", null], ["task", null]]);
  const requests: { id: string; completed: boolean; resolve: () => void; reject: (error: Error) => void }[] = [];
  const changes: { id: string; value: string | null }[] = [];
  let settled = 0;
  const queue = new ScheduleCompletionQueue({
    now: () => stamp,
    save: (id, completed) => new Promise<void>((resolve, reject) => requests.push({ id, completed, resolve, reject })),
    change: (id, value) => { values.set(id, value); changes.push({ id, value }); },
    settled: () => { settled++; },
  });
  return { queue, values, requests, changes, settled: () => settled };
}
async function tick() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
let f = fixture();
let saved = f.queue.update(item, true);
assert.equal(f.values.get("event"), stamp, "checking updates immediately before the network responds");
assert.equal(f.queue.update(item, true), saved, "duplicate completion intents share one background save");
assert.equal(f.requests.length, 1);
const refreshed = f.queue.overlay([{ ...item, title: "Updated by Google" }]);
assert.equal(refreshed[0].app_completed_at, stamp, "a stale refresh cannot uncheck a pending item");
assert.equal(refreshed[0].title, "Updated by Google", "optimism must preserve newly synced provider fields");
f.requests[0].resolve(); await saved;
assert(f.settled() > 0, "acknowledgements invalidate old reads");

f = fixture();
saved = f.queue.update(item, true);
f.queue.update(item, false);
assert.equal(f.values.get("event"), null, "undo also updates immediately while a save is pending");
f.requests[0].resolve(); await tick();
assert.equal(f.requests.length, 2);
assert.equal(f.requests[1].completed, false, "undo must be persisted after the older check");
assert.equal(f.values.get("event"), null, "an older success cannot visibly re-check an undone item");
f.requests[1].resolve(); await saved;

f = fixture();
saved = f.queue.update(item, true);
f.queue.update(item, false); f.queue.update(item, true);
f.requests[0].resolve(); await saved;
assert.equal(f.requests.length, 1, "quick check/undo/check coalesces to the already-saved final state");
assert.equal(f.values.get("event"), stamp);

f = fixture();
const eventSave = f.queue.update(item, true).catch(error => error);
const taskSave = f.queue.update({ ...item, id: "task", source: "google-task" }, true);
assert.equal(f.requests.length, 2, "other rows can save independently without waiting for this item");
f.requests[0].reject(new Error("Offline"));
f.requests[1].resolve();
assert.equal((await eventSave).message, "Offline"); await taskSave;
assert.equal(f.values.get("event"), null, "a failed save restores only its own acknowledged value");
assert.equal(f.values.get("task"), stamp, "another row's success must survive the failure");

f = fixture();
const failedUndo = f.queue.update(item, true).catch(error => error);
f.queue.update(item, false);
f.requests[0].resolve(); await tick();
f.requests[1].reject(new Error("Undo failed"));
assert.equal((await failedUndo).message, "Undo failed");
assert.equal(f.values.get("event"), stamp, "a failed undo restores the successful check, not the original unchecked state");

f = fixture();
saved = f.queue.update(item, true); f.queue.update(item, false);
f.requests[0].reject(new Error("Old request failed")); await tick();
assert.equal(f.values.get("event"), null, "a superseded failure cannot undo the newer choice");
assert.equal(f.requests.length, 2, "an unacknowledged write may have committed, so undo must explicitly save false");
assert.equal(f.requests[1].completed, false); f.requests[1].resolve(); await saved;

f = fixture();
const cancelled = f.queue.update(item, true).catch(error => error);
f.queue.update(item, false);
f.queue.dispose();
assert.equal((await cancelled).name, "AbortError");
const changes = f.changes.length;
f.requests[0].resolve(); await tick();
assert.equal(f.changes.length, changes, "late results cannot change another account's state");
assert.equal(f.requests.length, 1, "changing accounts cancels unsent old-account writes");
console.log("Instant schedule completion tests passed: immediate checks/undo, coalescing, independent rows, stale refreshes, rollback and account isolation.");

f = fixture();
const ambiguous = f.queue.update(item, true).catch(error => error); f.queue.update(item, false);
f.requests[0].reject(new Error("Lost check acknowledgement")); await tick();
f.requests[1].reject(new Error("Lost undo acknowledgement")); await ambiguous;
assert.equal(f.values.get("event"), null);
const corrective = f.queue.update(item, false);
assert.equal(f.requests.length, 3, "retry must still write an uncertain final choice even when it matches the visible rollback value");
assert.equal(f.requests[2].completed, false); f.requests[2].resolve(); await corrective;

// Journal every superseding choice before an older request finishes; simulate process death.
{
  const { DurableOperations } = await import("./durableOperations.ts");
  const disk = new Map<string,string>(); let sequence=0, value=false;
  let release!:()=>void; const gate=new Promise<void>(resolve=>release=resolve);
  const storage={getItem:async(key:string)=>disk.get(key)??null,setItem:async(key:string,raw:string)=>{disk.set(key,raw);}};
  const journal=new DurableOperations({userId:"actor",storage,makeId:()=>"staged-"+(++sequence),changed:()=>{},send:async()=>{await gate;throw Error("terminated");}});
  const q=new ScheduleCompletionQueue({save:async()=>{},change:()=>{},settled:()=>{},prepare:async(id,completed)=>{
    const staged=await journal.prepare({name:"update_personal_schedule_task",rpc:true,method:"POST",body:{task_id:id,completed},query:[],prefer:"",accept:""},"actor:home");
    return {send:async()=>{await staged.send();}};
  }});
  const item={id:"staged-task",app_completed_at:null} as any;
  const pending=q.update(item,true).catch(()=>{}); q.update(item,false).catch(()=>{});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(JSON.parse([...disk.values()][0]).operations.map((op:any)=>op.request.body.completed),[true,false]);
  q.dispose();journal.dispose();release();await pending;
  const restored=new DurableOperations({userId:"actor",storage,makeId:()=>"unused",changed:()=>{},send:async op=>{value=(op.request.body as any).completed;return {status:200,data:null};}});
  await restored.initialize();assert.equal(value,false);assert.equal(restored.pending.length,0);
}
console.log("Google completion superseding undo is durable before the first network acknowledgement");
