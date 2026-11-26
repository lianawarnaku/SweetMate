import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type Element = { type: string; props: Record<string, any> };
const source = readFileSync(resolve(process.cwd(), "components/GoogleScheduleControls.tsx"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, esModuleInterop: false, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;

// Exercise the actual picker and callbacks with native rendering and network
// boundaries replaced. In particular, successful OAuth must not unmount the
// first-time picker before the user saves their selected calendars and tasks.
function fixture(connected: boolean | null, enabled = false, configured = true) {
  const state: any[] = [];
  let cursor = 0, connects = 0;
  const configurations: any[][] = [];
  const connection = {
    connected, busy: false, error: null as string | null,
    refresh: async () => connection.connected === true,
    connect: async () => { connects++; connection.connected = true; },
  };
  const schedule = {
    userId: "member-a", ready: true, configured, loading: false, error: null as string | null, sharing: false,
    prefs: { enabled, calendar_ids: [] as string[], task_list_ids: [] as string[], timezone: "America/New_York" },
    sources: async () => ({ calendars: [{ id: "personal", name: "Personal calendar" }], taskLists: [{ id: "tasks", name: "My tasks" }] }),
    configure: async (...args: any[]) => { configurations.push(args); schedule.configured = true; schedule.prefs = { ...schedule.prefs, enabled: args[3], calendar_ids: args[0], task_list_ids: args[1] }; },
    sync: async () => {}, shareBusy: async () => {},
  };
  const jsx = (type: string, props: Record<string, any>) => ({ type, props });
  const modules: Record<string, any> = {
    react: { useState: (initial: any) => { const slot = cursor++; if (!(slot in state)) state[slot] = initial; return [state[slot], (value: any) => { state[slot] = typeof value === "function" ? value(state[slot]) : value; }]; } },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { ActivityIndicator: "ActivityIndicator", Modal: "Modal", ScrollView: "ScrollView", Text: "Text", TouchableOpacity: "TouchableOpacity", View: "View", StyleSheet: { create: (value: any) => value } },
    "@expo/vector-icons": { Feather: "Feather" },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    "@/components/GlassButton": { GlassButton: "GlassButton" },
    "@/components/GlassModalSurface": { GlassModalBackdrop: "GlassModalBackdrop", GlassModalSurface: "GlassModalSurface" },
    "@/components/AppSwitch": { AppSwitch: "AppSwitch" },
    "@/constants/colors": { useTheme: () => ({}) },
    "@/hooks/useAccessibilityPreferences": { useAccessibilityPreferences: () => ({ reduceMotion: true }) },
    "@/hooks/useGoogleCalendarConnection": { useGoogleCalendarConnection: () => connection },
  };
  const exports: any = {};
  runInNewContext(compiled, { exports, Intl, require: (name: string) => { assert(name in modules, `Unexpected runtime import: ${name}`); return modules[name]; } });
  return {
    connection, schedule, configurations, connects: () => connects,
    render: (placement: "home" | "settings" = "home"): Element | null => {
      cursor = 0;
      return exports.GoogleScheduleControls({ schedule, householdId: "home-a", day: "2026-11-25", placement });
    },
  };
}
function visibleNodes(node: Element | null): Element[] {
  if (!node || (node.type === "Modal" && !node.props.visible)) return [];
  return [node, ...[node.props.children].flat(Infinity).filter(value => value && typeof value === "object" && "type" in value).flatMap(value => visibleNodes(value))];
}
function text(node: any): string {
  return typeof node === "string" ? node : node && typeof node === "object" ? [node.props.children].flat(Infinity).map(text).join("") : "";
}
function action(tree: Element | null, label: string): Element {
  const found = visibleNodes(tree).find(node => node.props.accessibilityLabel === label || (node.type === "GlassButton" || node.props.accessibilityRole === "button") && text(node) === label);
  assert(found, `Expected action: ${label}`);
  return found;
}
async function settle() { for (let step = 0; step < 12; step++) await Promise.resolve(); }

assert.equal(fixture(null).render(), null, "checking an existing connection must not flash a Connect link");
for (const importing of [false, true]) {
  assert.equal(fixture(true, importing).render(), null, "connected My Sweet must have no management link, refresh control, or empty control space");
  action(fixture(true, importing).render("settings"), "Manage Google Calendar");
}
action(fixture(false, true).render(), "Connect your Google schedule");
const errors = fixture(true, true); errors.schedule.error = "Sync unavailable";
assert(visibleNodes(errors.render()).some(node => node.props.accessibilityRole === "alert"));
assert(!visibleNodes(errors.render()).some(node => node.props.accessibilityRole === "button"), "sync feedback must not add management access back to My Sweet");

const first = fixture(false);
action(first.render(), "Connect your Google schedule").props.onPress();
await settle();
assert.equal(first.connects(), 1);
let picker = first.render();
assert(visibleNodes(picker).some(node => node.type === "Modal" && node.props.visible), "the original picker stays open after successful OAuth");
action(picker, "Personal calendar").props.onPress();
action(first.render(), "My tasks").props.onPress();
action(first.render(), "Save").props.onPress();
await settle();
assert.deepEqual(JSON.parse(JSON.stringify(first.configurations)), [[["personal"], ["tasks"], "America/New_York", true]], "the first connection must retain and save both selected source types");
assert.equal(first.render(), null, "saving first-time selections removes the My Sweet link");

const settings = fixture(true, true);
action(settings.render("settings"), "Manage Google Calendar").props.onPress();
await settle();
assert.equal(settings.connects(), 0, "managing an existing connection does not repeat Google consent");
action(settings.render("settings"), "Personal calendar");
action(settings.render("settings"), "My tasks");
action(settings.render("settings"), "Stop importing").props.onPress();
await settle();
assert.equal(settings.schedule.prefs.enabled, false);
action(settings.render("settings"), "Manage Google Calendar");
assert.equal(settings.render(), null, "stopping imports does not expose a manager on My Sweet while Google remains connected");
settings.connection.connected = false;
action(settings.render(), "Connect your Google schedule");
console.log("Google schedule controls passed: connected Home stays clear, first-time selection survives OAuth, Settings manages sources, and disconnect restores connection entry.");

const anotherHome = fixture(true, false, false);
action(anotherHome.render(), "Connect your Google schedule");
action(anotherHome.render("settings"), "Connect Google Calendar");
action(anotherHome.render(), "Connect your Google schedule").props.onPress(); await settle();
assert.equal(anotherHome.connects(), 0, "a new household reuses valid personal OAuth authorization");
assert.equal(action(anotherHome.render(), "Personal calendar").props.accessibilityState.checked, false, "new household choices start empty");
action(anotherHome.render(), "Personal calendar").props.onPress();
action(anotherHome.render(), "Save").props.onPress(); await settle();
assert.equal(anotherHome.render(), null, "only saving this household's setup hides its Home connection link");
const loadingHousehold = fixture(true, false, false); loadingHousehold.schedule.ready = false;
assert.equal(loadingHousehold.render(), null, "loading an existing household must not flash a first-time setup link");
console.log("New households expose Connect in My Sweet and Settings independently of another home's Google authorization");
