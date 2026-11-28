import { saveFeedback } from "./saveFeedback.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as schedule from "./personalSchedule.ts";
import { ScheduleCompletionQueue } from "./scheduleCompletionQueue.ts";
import { householdDueDate } from "./choreTimezone.ts";
import { withAlpha } from "./contrast.ts";
import { resolveThemeTokens } from "../constants/themeTokens.ts";

type Element = { type: string | ((props: any) => Element); props: Record<string, any> };
const compiled = ts.transpileModule(readFileSync(resolve(process.cwd(), "components/PersonalAgenda.tsx"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: false, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const now = Date.parse("2026-11-25T16:30:00Z");
class Clock extends Date { static now() { return now; } }
const base: schedule.PersonalScheduleItem = { id: "event", user_id: "me", source: "google-event", resource_id: "calendar", provider_id: "event", title: "Timed event",
  starts_at: "2026-11-25T16:00:00Z", ends_at: "2026-11-25T17:00:00Z", starts_on: null, ends_on: null, busy: true, link: null,
  app_completed_at: null, override_start: null, override_end: null, period_override: null };
function fixture() {
  let items: schedule.PersonalScheduleItem[] = [{ ...base }, { ...base, id: "task", source: "google-task", title: "Untimed task", starts_at: null, ends_at: null, starts_on: null, busy: false }];
  const state: any[] = [], updates: { id: string; update: schedule.TaskScheduleUpdate }[] = [], links: string[] = [];
  let cursor = 0, fail = false;
  const haptics: string[] = [], completingIds = new Set<string>();
  let saveGate: Promise<void> | null = null, finishSave: (() => void) | null = null;
  const completionQueue = new ScheduleCompletionQueue({
    now: () => new Date(now).toISOString(), settled: () => {},
    change: (id, completedAt) => { items = items.map(item => item.id === id ? { ...item, app_completed_at: completedAt } : item); },
    save: async (id, completed) => {
      updates.push({ id, update: { completed } });
      if (saveGate) await saveGate;
      if (fail) { fail = false; throw Error("Save failed"); }
    },
  });
  const useState = (initial: any) => { const slot = cursor++; if (!(slot in state)) state[slot] = typeof initial === "function" ? initial() : initial; return [state[slot], (value: any) => { state[slot] = typeof value === "function" ? value(state[slot]) : value; }]; };
  const react = { useState, useEffect: () => {}, useSyncExternalStore: (_subscribe: any, get: any) => get(), useRef: (value: any) => useState(() => ({ current: value }))[0], Fragment: "Fragment" };
  const jsx = (type: Element["type"], props: Element["props"]) => ({ type, props });
  const native = Object.fromEntries(["ActivityIndicator", "KeyboardAvoidingView", "Modal", "ScrollView", "Text", "TextInput", "TouchableOpacity", "View"].map(name => [name, name]));
  const modules: Record<string, any> = {
    react: { ...react, default: react }, "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { ...native, StyleSheet: { create: (value: any) => value, absoluteFill: {} }, Linking: { openURL: async (url: string) => { links.push(url); } } },
    "react-native-svg": { default: "Svg", Circle: "Circle" }, "@expo/vector-icons": { Feather: "Feather" },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    "@/lib/saveFeedback": { saveFeedback },
    "@/components/SaveFeedbackNotice": { SaveFeedbackNotice: "SaveFeedbackNotice" },
    "@/components/GlassButton": { GlassButton: "GlassButton" }, "@/components/GlassModalSurface": { GlassModalBackdrop: "GlassModalBackdrop", GlassModalSurface: "GlassModalSurface" },
    "@/components/Surface": { Surface: "Surface" }, "@/components/GlassCheckCircle": { GlassCheckCircle: "GlassCheckCircle" },
    "@/components/CompletionMotion": { CompletionMotion: "CompletionMotion", CompletionText: "CompletionText" },
    "@/hooks/useCompletionFeedback": { useCompletionFeedback: () => ({ completingIds, holdCompletion: (id: string) => completingIds.add(id), cancelCompletion: (id: string) => completingIds.delete(id) }) },
    "@/lib/haptics": { success: () => haptics.push("success"), error: () => haptics.push("error"), tapLight: () => haptics.push("tap") },
    "@/constants/colors": { useTheme: () => resolveThemeTokens("dark", "mono") },
    "@/hooks/useAccessibilityPreferences": { useAccessibilityPreferences: () => ({ reduceMotion: true }) },
    "@/lib/keyboard": { KEYBOARD_BEHAVIOR: undefined }, "@/lib/choreTimezone": { householdDueDate },
    "@/lib/personalSchedule": schedule, "@/lib/contrast": { withAlpha },
  };
  const rowExports: any = {};
  const rowSource = ts.transpileModule(readFileSync(resolve(process.cwd(), "components/MyDayRow.tsx"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: false, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  modules["@/constants/designTokens"] = { radii: { card: 22, small: 10 }, spacing: { xs: 4, sm: 8, md: 12 }, typography: { label: { fontSize: 15, lineHeight: 19 }, caption: { fontSize: 13, lineHeight: 17 } } };
  runInNewContext(rowSource, { exports: rowExports, require: (name: string) => { assert(name in modules, name); return modules[name]; } });
  modules["@/components/MyDayRow"] = rowExports;
  const exports: any = {};
  runInNewContext(compiled, { exports, Date: Clock, Intl, require: (name: string) => { assert(name in modules, `Unexpected runtime import: ${name}`); return modules[name]; } });
  return {
    updates, links, haptics, completingIds, failOnce: () => { fail = true; },
    pauseNextSave: () => { saveGate = new Promise<void>(resolve => { finishSave = resolve; }); },
    finishSave: () => { finishSave?.(); saveGate = null; },
    releaseFeedback: () => completingIds.clear(),
    render: (): Element => {
      cursor = 0;
      return exports.PersonalAgenda({ items, chores: [], day: "2026-11-25", timezone: "America/New_York", renderChore: () => null,
        onUpdateItem: async (id: string, update: schedule.TaskScheduleUpdate) => {
          if (typeof update.completed === "boolean") {
            await completionQueue.update(items.find(item => item.id === id)!, update.completed);
            return;
          }
          updates.push({ id, update });
          if (saveGate) await saveGate;
          if (fail) { fail = false; throw Error("Save failed"); }
          items = items.map(item => item.id !== id ? item : { ...item,
            app_completed_at: update.completed === undefined ? item.app_completed_at : update.completed ? new Date(now).toISOString() : null,
            period_override: update.period ?? item.period_override,
            override_start: update.clearTime ? null : update.start ?? item.override_start,
            override_end: update.clearTime ? null : update.end ?? item.override_end,
          });
        },
      });
    },
  };
}
function host(node: Element): Element { return typeof node.type === "function" ? host(node.type(node.props)) : node; }
function nodes(value: Element | null): Element[] {
  if (!value) return [];
  const node = host(value);
  if (node.type === "Modal" && !node.props.visible) return [];
  return [node, ...[node.props.children].flat(Infinity).filter(child => child && typeof child === "object" && "type" in child).flatMap(child => nodes(child))];
}
function text(node: any): string { return typeof node === "string" ? node : node && typeof node === "object" ? [node.props.children].flat(Infinity).map(text).join("") : ""; }
function action(tree: Element, label: string): Element {
  const found = nodes(tree).find(node => node.props.accessibilityLabel === label || (node.type === "GlassButton" || node.props.accessibilityRole === "button") && text(node) === label);
  assert(found, `Expected action ${label}`); return found;
}
async function settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
const f = fixture();
let tree = f.render();
const eventCheck = action(tree, "Complete in SweetMate: Timed event");
const initialRow = nodes(tree).find(node => node.type === "Surface");
assert(initialRow);
const sharedCard = initialRow.props.style[0];
assert.equal(sharedCard.minHeight, 80);
assert.equal(sharedCard.borderRadius, 22);
assert.equal(sharedCard.paddingVertical, 12);
assert.equal(initialRow.props.level, "subtle", "Google rows use the same solid treatment as chores");
assert(nodes(tree).filter(node => node.type === "CompletionMotion").length === 2, "every imported row gets the shared completion motion");
const rowOrder = (tree: Element) => nodes(tree).filter(node => String(node.props.accessibilityLabel ?? "").startsWith("View details:")).map(node => node.props.accessibilityLabel);
f.pauseNextSave();
assert.equal(eventCheck.props.accessibilityRole, "checkbox");
const arc = nodes(eventCheck).find(node => node.type === "Circle" && node.props.strokeDashoffset !== undefined);
assert(arc && Math.abs(arc.props.strokeDashoffset - arc.props.r * Math.PI) < 0.0001, "a half-elapsed event must draw a half white arc around its checkmark");
eventCheck.props.onPress(); eventCheck.props.onPress(); await settle();
assert.equal(f.haptics.join(","), "success", "check-off feedback follows the tap before saving completes");
const pendingCheck = action(f.render(), "Mark incomplete in SweetMate: Timed event");
assert.equal(pendingCheck.props.accessibilityState.checked, true, "the checkmark updates before the network responds");
assert.equal(pendingCheck.props.disabled, false, "the user can undo without waiting for a save");
assert(!nodes(pendingCheck).some(node => node.type === "ActivityIndicator"), "checking an item must never show a loading spinner");
assert.equal(action(f.render(), "Complete in SweetMate: Untimed task").props.disabled, false, "another item remains interactive while this one saves");
assert(nodes(pendingCheck).some(node => node.type === "GlassCheckCircle"), "saving must preserve the mounted checkbox for its check animation");
assert(pendingCheck.props.accessibilityState.busy);
f.finishSave(); await settle();
assert.equal(f.haptics.join(","), "success");
assert.equal(rowOrder(f.render()).join(","), "View details: Timed event,View details: Untimed task", "a checked event stays in place for its visible jiggle");
f.releaseFeedback();
assert.equal(rowOrder(f.render()).join(","), "View details: Untimed task,View details: Timed event", "completed events move only after feedback finishes");
assert.equal(f.updates.length, 1, "rapid checkbox taps must not submit duplicate mutations");
assert.equal(f.updates[0].id, "event"); assert.equal(f.updates[0].update.completed, true);
tree = f.render();
assert(!nodes(tree).some(node => node.type === "Modal"), "checking an event must not open its detail card");
const checked = action(tree, "Mark incomplete in SweetMate: Timed event");
assert.equal(checked.props.accessibilityState.checked, true);
assert.equal(checked.props.accessibilityHint, "Completed in SweetMate.");
assert.equal(nodes(checked).find(node => node.type === "Circle" && node.props.strokeDashoffset !== undefined)?.props.strokeDashoffset, 0, "a checked item must have a full white ring");
checked.props.onPress(); await settle();
assert.equal(f.haptics.at(-1), "tap", "unchecking uses a light tap rather than a completion celebration");
action(f.render(), "View details: Timed event").props.onPress();
tree = f.render();
assert(nodes(tree).some(node => node.type === "Modal" && node.props.visible), "events with no provider link must still open SweetMate details");
assert(!nodes(tree).some(node => node.type === "TextInput"), "Google event dates stay read-only");
assert.equal(f.links.length, 0, "opening item details must not launch Google");
action(tree, "Complete in SweetMate: Timed event").props.onPress(); await settle();
tree = f.render();
assert(nodes(tree).some(node => text(node) === "Completed in SweetMate"), "details must reflect an event completion immediately");
action(tree, "Mark incomplete in SweetMate: Timed event").props.onPress(); await settle();
action(f.render(), "Done").props.onPress();
action(f.render(), "View details: Untimed task").props.onPress();
tree = f.render();
assert(nodes(tree).some(node => node.props.accessibilityLabel === "Task start time, HH:MM"), "tasks must retain their local scheduling editor");
action(tree, "Night").props.onPress();
action(f.render(), "Task start time, HH:MM").props.onChangeText("13:00");
action(f.render(), "Task end time, HH:MM").props.onChangeText("14:00");
action(f.render(), "Save").props.onPress(); await settle();
assert.equal(f.updates.at(-1)?.id, "task");
assert.equal(f.updates.at(-1)?.update.start, "2026-11-25T18:00:00.000Z");
assert.equal(f.updates.at(-1)?.update.end, "2026-11-25T19:00:00.000Z");
action(f.render(), "Complete in SweetMate: Untimed task").props.onPress(); await settle();
assert.equal(action(f.render(), "Mark incomplete in SweetMate: Untimed task").props.accessibilityState.checked, true, "Google Tasks must remain checkable");
assert.equal(f.haptics.at(-1), "success", "Google Tasks get the same successful check-off haptic as events");
const failed = fixture(); failed.failOnce();
action(failed.render(), "Complete in SweetMate: Timed event").props.onPress(); await settle();
assert.equal(action(failed.render(), "Complete in SweetMate: Timed event").props.accessibilityState.checked, false, "failed completion must leave the item unchecked");
assert(nodes(failed.render()).some(node => node.props.accessibilityRole === "alert" && text(node) === "Save failed"));
assert.equal(failed.haptics.join(","), "success,error", "a rejected optimistic check gets failure feedback");
assert.equal(failed.completingIds.size, 0, "failed saves cannot hold a row as completed");
const independent = fixture(); independent.pauseNextSave();
action(independent.render(), "Complete in SweetMate: Timed event").props.onPress();
action(independent.render(), "Complete in SweetMate: Untimed task").props.onPress();
assert.equal(independent.updates.length, 2, "separate rows start saving without blocking each other");
assert.equal(action(independent.render(), "Mark incomplete in SweetMate: Timed event").props.accessibilityState.checked, true);
assert.equal(action(independent.render(), "Mark incomplete in SweetMate: Untimed task").props.accessibilityState.checked, true);
independent.finishSave(); await settle();
const rapid = fixture(); rapid.pauseNextSave();
action(rapid.render(), "Complete in SweetMate: Timed event").props.onPress();
action(rapid.render(), "Mark incomplete in SweetMate: Timed event").props.onPress();
assert.equal(action(rapid.render(), "Complete in SweetMate: Timed event").props.accessibilityState.checked, false, "rapid undo takes effect immediately");
rapid.finishSave(); await settle();
assert.equal(rapid.updates.at(-1)?.update.completed, false, "rapid undo is saved after the old check");
console.log("Imported item row/detail/checkbox runtime checks passed: immediate checks and undo, no loading spinners, independent rows, rollback, ring progress, details and task scheduling.");

const timedEditor = fixture();
action(timedEditor.render(), "View details: Untimed task").props.onPress();
action(timedEditor.render(), "Task start time, HH:MM").props.onChangeText("18:15");
action(timedEditor.render(), "Task end time, HH:MM").props.onChangeText("18:45");
assert(action(timedEditor.render(), "Night").props.accessibilityState.checked, "18:15 must automatically select Night");
assert(action(timedEditor.render(), "Day").props.disabled, "timed tasks explain why their period is derived from Start");
action(timedEditor.render(), "Day").props.onPress();
assert.equal(action(timedEditor.render(), "Task start time, HH:MM").props.value, "18:15", "period controls must never erase an entered start time");
assert.equal(action(timedEditor.render(), "Task end time, HH:MM").props.value, "18:45", "period controls must never erase an entered end time");
action(timedEditor.render(), "Save").props.onPress(); await settle();
assert.equal(timedEditor.updates.at(-1)?.update.period, "night");
assert.equal(timedEditor.updates.at(-1)?.update.start, "2026-11-25T23:15:00.000Z");
assert.equal(timedEditor.updates.at(-1)?.update.end, "2026-11-25T23:45:00.000Z");
console.log("Task time edits survive period taps and derive Day/Night from the saved start time");
