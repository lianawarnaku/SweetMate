import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { fetchAllRows } from "./pagination.ts";
import { saveFeedback, saveRequest } from "./saveFeedback.ts";
import { ScheduleCompletionQueue } from "./scheduleCompletionQueue.ts";
import type { PersonalScheduleItem } from "./personalSchedule.ts";

const code = ts.transpileModule(readFileSync(resolve(process.cwd(), "hooks/usePersonalSchedule.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: false, target: ts.ScriptTarget.ES2022 },
}).outputText;
const base: PersonalScheduleItem = { id: "event", user_id: "me", source: "google-event", resource_id: "calendar", provider_id: "event", title: "Event",
  starts_at: null, ends_at: null, starts_on: "2026-11-25", ends_on: "2026-11-26", busy: false, link: null,
  app_completed_at: null, override_start: null, override_end: null, period_override: null };
function fixture() {
  const state: any[] = [];
  let cursor = 0, holdReads = false;
  let serverItems = [{ ...base }, { ...base, id: "task", source: "google-task" as const, resource_id: "tasks" }];
  const reads: (() => void)[] = [], queries: string[] = [];
  const configurations: any[] = [];
  const preferences = new Map<string, any>([["home", { enabled: true, calendar_ids: ["calendar"], task_list_ids: ["tasks"], timezone: "America/New_York" }]]);
  const writes: { id: string; completed: boolean; finish: (error?: Error) => void }[] = [];
  const useState = (initial: any) => { const index = cursor++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], (value: any) => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; };
  const react = { useState, useRef: (value: any) => useState(() => ({ current: value }))[0], useEffect: () => {}, useCallback: (fn: any) => fn };
  const read = (table: string, user: string, household: string, after?: string, count = 250) => {
    queries.push(table);
    const data = table === "personal_schedule_items" ? serverItems.filter(item => item.user_id === user && (!after || item.id > after)).sort((a,b) => a.id < b.id ? -1 : 1).slice(0,count)
      : table === "personal_schedule_preferences" ? { synced_at: null, sync_error: null }
      : table === "member_schedule_preferences" ? preferences.has(household) ? { user_id: user, household_id: household, ...preferences.get(household) } : null : { enabled: false };
    const result = { data: JSON.parse(JSON.stringify(data)), error: null };
    return holdReads ? new Promise<any>(resolve => reads.push(() => resolve(result))) : Promise.resolve(result);
  };
  const from = (table: string) => {
    let user = "me", household = "home", after: string | undefined, count = 250;
    const builder: any = { select: () => builder, eq: (column: string, value: string) => { if (column === "user_id") user = value; if (column === "household_id") household = value; return builder; },
      order: () => builder, gt: (_key: string, value: string) => { after = value; return builder; }, limit: (value: number) => { count = value; return builder; }, maybeSingle: () => read(table, user, household), then: (yes: any, no: any) => read(table, user, household, after, count).then(yes, no) };
    return builder;
  };
  const modules: Record<string, any> = {
    react, "react-native": { AppState: {}, Platform: { OS: "ios" } },
    "@/lib/scheduleCompletionQueue": { ScheduleCompletionQueue },
    "@/lib/pagination": { fetchAllRows },
    "@/lib/saveFeedback": { saveFeedback, saveRequest },
    "@/lib/supabase": { supabase: { from, auth: { getSession: async () => ({ data: { session: { access_token: "fixture-token" } } }) }, rpc: (name: string, update: any) => {
      if (name === "configure_household_schedule") {
        configurations.push(update);
        preferences.set(update.target_household_id, { enabled: update.enable_sync, calendar_ids: update.calendar_ids, task_list_ids: update.task_list_ids, timezone: update.schedule_timezone });
        return Promise.resolve({ error: null });
      }
      assert.equal(name, "update_personal_schedule_task");
      const request = new Promise(resolve => writes.push({ id: update.task_id, completed: update.completed, finish: error => {
        if (!error) serverItems = serverItems.map(item => item.id === update.task_id ? { ...item, app_completed_at: update.completed ? "2026-11-25T17:00:00.000Z" : null } : item);
        resolve({ error: error ?? null });
      } }));
      return Object.assign(request, { abortSignal: () => request });
    } } },
  };
  const exports: any = {};
  runInNewContext(code, { exports, process: { env: { EXPO_PUBLIC_SUPABASE_URL: "http://local-fixture" } }, fetch: async () => ({ ok: true, json: async () => ({}) }), require: (name: string) => { assert(name in modules, name); return modules[name]; } });
  return { writes, queries, configurations,
    render: (user = "me", household = "home") => { cursor = 0; return exports.usePersonalSchedule(user, household, false); },
    holdReads: () => { holdReads = true; }, releaseReads: () => { holdReads = false; while (reads.length) reads.shift()!(); },
    renameOnServer: () => { serverItems[0] = { ...serverItems[0], title: "Updated event title" }; },
  };
}
async function tick() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
async function loaded() { const f = fixture(); await f.render().refresh(); return f; }
let f = await loaded();
let api = f.render();
const initialReads = f.queries.length;
let pending = api.updateTask("event", { completed: true });
api = f.render();
assert(api.items.find((item: PersonalScheduleItem) => item.id === "event").app_completed_at, "shared app state updates synchronously with the check");
assert.equal(api.loading, false, "checkbox writes must not start full-schedule loading");
assert.equal(f.queries.length, initialReads, "a check must not refetch the whole schedule");
f.renameOnServer(); f.holdReads();
const refreshWhilePending = api.refresh(); await tick(); f.releaseReads(); await refreshWhilePending;
api = f.render();
assert.equal(api.items[0].title, "Updated event title", "background sync can still update event details");
assert(api.items[0].app_completed_at, "old server completion values cannot flash over a pending check");
f.holdReads(); const oldRead = api.refresh(); await tick();
f.writes[0].finish(); await pending;
f.releaseReads(); await oldRead;
api = f.render();
assert(api.items[0].app_completed_at, "a read started before acknowledgement must be ignored after saving");
const afterReads = f.queries.length;
pending = api.updateTask("event", { completed: false });
assert.equal(f.render().items[0].app_completed_at, null, "undo updates shared state immediately too");
f.writes[1].finish(new Error("Save failed"));
await assert.rejects(pending, /Save failed/);
assert(f.render().items[0].app_completed_at, "a failed undo restores the last acknowledged check");
assert.equal(f.queries.length, afterReads, "rollback does not require another loading round trip");

f = await loaded(); api = f.render();
const eventSave = api.updateTask("event", { completed: true });
const taskSave = api.updateTask("task", { completed: true });
assert.equal(f.writes.length, 2, "separate rows save concurrently");
assert(f.render().items.every((item: PersonalScheduleItem) => item.app_completed_at));
f.writes[0].finish(); f.writes[1].finish(); await Promise.all([eventSave, taskSave]);

f = await loaded(); api = f.render();
const oldAccount = api.updateTask("event", { completed: true }).catch((error: Error) => error);
api = f.render("other");
assert.equal(api.items.length, 0, "account switching immediately hides the previous person's schedule");
assert.equal((await oldAccount).name, "AbortError");
f.writes[0].finish(); await tick();
assert.equal(f.render("other").items.length, 0, "late save results cannot populate another account");
console.log("Personal schedule hook checks passed: instant shared state, no per-check reload, refresh race protection, rollback, concurrency and account isolation.");

const homes = await loaded();
assert(homes.render().configured && homes.render().ready);
const oldHome = homes.render();
homes.holdReads(); const oldHouseholdRead = oldHome.refresh(); await tick();
let freshHome = homes.render("me", "new-home");
assert.equal(freshHome.ready, false, "switching households cannot expose the old household's ready flag");
assert.equal(freshHome.configured, false);
assert.equal(freshHome.prefs, null);
assert.equal(freshHome.items.length, 0, "old imported items must disappear synchronously on household switch");
homes.releaseReads(); await oldHouseholdRead;
assert.equal(homes.render("me", "new-home").prefs, null, "a late read cannot restore another household's setup");
await homes.render("me", "new-home").refresh();
freshHome = homes.render("me", "new-home");
assert(freshHome.ready && !freshHome.configured);
assert.equal(freshHome.items.length, 0, "account-wide imported cache must stay hidden until this household opts in");
await assert.rejects(oldHome.configure(["calendar"], [], "UTC", true), { name: "AbortError" });
assert.equal(homes.configurations.length, 0, "a stale picker cannot configure the newly selected household");
await freshHome.configure(["calendar"], [], "America/New_York", true);
assert.equal(homes.configurations[0].target_household_id, "new-home");
assert(homes.render("me", "new-home").configured);
assert.equal(homes.render("me", "new-home").items.length, 1, "the new home's source choices must filter imports independently");
await homes.render("me", "new-home").configure([], [], "America/New_York", false);
assert.equal(homes.render("me", "new-home").prefs.enabled, false);
await homes.render("me", "home").refresh();
assert(homes.render("me", "home").prefs.enabled);
assert.equal(homes.render("me", "home").items.length, 2, "returning to the original household restores its unchanged calendar and task choices");
console.log("Household schedule setup, immediate switch isolation, stale reads/pickers and independent source selections passed");
