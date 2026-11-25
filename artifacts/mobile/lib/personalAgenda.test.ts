import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as schedule from "./personalSchedule.ts";
import { householdDueDate } from "./choreTimezone.ts";
import { withAlpha } from "./contrast.ts";
import { resolveThemeTokens } from "../constants/themeTokens.ts";

type Element = { type: string | ((props: any) => Element); props: Record<string, any> };
const compiled = ts.transpileModule(readFileSync(resolve(process.cwd(), "components/PersonalAgenda.tsx"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
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
  const useState = (initial: any) => { const slot = cursor++; if (!(slot in state)) state[slot] = typeof initial === "function" ? initial() : initial; return [state[slot], (value: any) => { state[slot] = typeof value === "function" ? value(state[slot]) : value; }]; };
  const react = { useState, useEffect: () => {}, useRef: (value: any) => useState(() => ({ current: value }))[0], Fragment: "Fragment" };
  const jsx = (type: Element["type"], props: Element["props"]) => ({ type, props });
  const native = Object.fromEntries(["ActivityIndicator", "KeyboardAvoidingView", "Modal", "ScrollView", "Text", "TextInput", "TouchableOpacity", "View"].map(name => [name, name]));
  const modules: Record<string, any> = {
    react: { ...react, default: react }, "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { ...native, StyleSheet: { create: (value: any) => value, absoluteFill: {} }, Linking: { openURL: async (url: string) => { links.push(url); } } },
    "react-native-svg": { default: "Svg", Circle: "Circle" }, "@expo/vector-icons": { Feather: "Feather" },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    "@/components/GlassButton": { GlassButton: "GlassButton" }, "@/components/GlassModalSurface": { GlassModalBackdrop: "GlassModalBackdrop", GlassModalSurface: "GlassModalSurface" },
    "@/components/Surface": { Surface: "Surface" }, "@/components/GlassCheckCircle": { GlassCheckCircle: "GlassCheckCircle" },
    "@/constants/colors": { useTheme: () => resolveThemeTokens("dark", "mono") },
    "@/hooks/useAccessibilityPreferences": { useAccessibilityPreferences: () => ({ reduceMotion: true }) },
    "@/lib/keyboard": { KEYBOARD_BEHAVIOR: undefined }, "@/lib/choreTimezone": { householdDueDate },
    "@/lib/personalSchedule": schedule, "@/lib/contrast": { withAlpha },
  };
  const exports: any = {};
  runInNewContext(compiled, { exports, Date: Clock, Intl, require: (name: string) => { assert(name in modules, `Unexpected runtime import: ${name}`); return modules[name]; } });
  return {
    updates, links, failOnce: () => { fail = true; },
    render: (): Element => {
      cursor = 0;
      return exports.PersonalAgenda({ items, chores: [], day: "2026-11-25", timezone: "America/New_York", renderChore: () => null,
        onUpdateItem: async (id: string, update: schedule.TaskScheduleUpdate) => {
          updates.push({ id, update }); if (fail) { fail = false; throw Error("Save failed"); }
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
assert.equal(eventCheck.props.accessibilityRole, "checkbox");
const arc = nodes(eventCheck).find(node => node.type === "Circle" && node.props.strokeDashoffset !== undefined);
assert(arc && Math.abs(arc.props.strokeDashoffset - 21 * Math.PI) < 0.0001, "a half-elapsed event must draw a half white arc around its checkmark");
eventCheck.props.onPress(); eventCheck.props.onPress(); await settle();
assert.equal(f.updates.length, 1, "rapid checkbox taps must not submit duplicate mutations");
assert.equal(f.updates[0].id, "event"); assert.equal(f.updates[0].update.completed, true);
tree = f.render();
assert(!nodes(tree).some(node => node.type === "Modal"), "checking an event must not open its detail card");
const checked = action(tree, "Mark incomplete in SweetMate: Timed event");
assert.equal(checked.props.accessibilityState.checked, true);
assert.equal(checked.props.accessibilityHint, "Completed in SweetMate.");
assert.equal(nodes(checked).find(node => node.type === "Circle" && node.props.strokeDashoffset !== undefined)?.props.strokeDashoffset, 0, "a checked item must have a full white ring");
checked.props.onPress(); await settle();
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
const failed = fixture(); failed.failOnce();
action(failed.render(), "Complete in SweetMate: Timed event").props.onPress(); await settle();
assert.equal(action(failed.render(), "Complete in SweetMate: Timed event").props.accessibilityState.checked, false, "failed completion must leave the item unchecked");
assert(nodes(failed.render()).some(node => node.props.accessibilityRole === "alert" && text(node) === "Save failed"));
console.log("Imported item row/detail/checkbox runtime checks passed: events and tasks, ring progress, independent controls, failure preservation, and task scheduling.");
