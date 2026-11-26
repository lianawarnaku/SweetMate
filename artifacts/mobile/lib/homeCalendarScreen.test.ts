import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { isChoreActiveOnDay, choreLocalDateKey, choreScheduledDate } from "./choreOccurrences.ts";
import { householdDateKey } from "./choreTimezone.ts";
import * as choreLifecycle from "./choreLifecycle.ts";
import * as chorePermissions from "./chorePermissions.ts";

type Element = { type: any; key?: string; props: Record<string, any> };
const children = (node: any): Element[] => !node || typeof node !== "object" || !node.props ? [] : [node, ...[node.props.children, node.props.ListHeaderComponent].flat(Infinity).flatMap(children)];
function fixture(savedList = false, savedDismissal = false, reduceMotion = false) {
  const slots: any[] = [], effects: any[] = [], pending: Array<() => void> = [];
  let cursor = 0;
  const storage = new Map<string, string>();
  if (savedList) storage.set("sweetmate:pinch-list-view:v1:avery:home", "list");
  if (savedDismissal) storage.set("sweetmate:home-summary-dismissed:v1:home:avery", new Date().toISOString().slice(0, 10));
  const useState = (initial: any) => { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (next: any) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; };
  const react = { useState, useRef: (value: any) => useState(() => ({ current: value }))[0], useMemo: (fn: any) => fn(), useCallback: (fn: any) => fn,
    useEffect: (effect: any, deps: any[]) => { const index = cursor++, prior = effects[index];
      if (prior && deps.every((value, j) => Object.is(value, prior.deps[j]))) return;
      pending.push(() => { prior?.cleanup?.(); effects[index] = { deps, cleanup: effect() }; }); } };
  const jsx = (type: any, props: any, key?: string) => ({ type, props, key });
  const motion: any = { duration: () => motion, delay: () => motion, easing: () => motion, reduceMotion: () => motion };
  const animation = { start: () => {}, stop: () => {} };
  class Value { value: number; constructor(value: number) { this.value = value; } setValue(value: number) { this.value = value; } addListener() { return "listener"; } removeListener() {} interpolate() { return 0; } }
  const context = { personalSchedule: { prefs: null, items: [], ready: true, loading: false, configured: false }, currentUserId: "avery", householdId: "home", householdTimezone: "UTC", activeSweet: {}, chores: [] as any[], roommates: [{ id: "avery", name: "Avery" }], expenses: [], shoppingLists: [], shoppingItems: [], pointsEnabled: false, isHost: true };
  const passthrough = (items: any) => items;
  const empty = () => [];
  const modules: Record<string, any> = {
    react, "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { View: "NativeView", Text: "Text", TouchableOpacity: "Button", Modal: "Modal", KeyboardAvoidingView: "Keyboard", Animated: { Value, View: "AnimatedView", timing: () => animation, spring: () => animation }, Dimensions: { get: () => ({ width: 390, height: 844 }) }, PanResponder: { create: () => ({ panHandlers: {} }) }, Platform: { OS: "ios" }, StyleSheet: { create: passthrough, absoluteFill: {}, hairlineWidth: 1 }, LayoutAnimation: { configureNext: () => {}, Presets: { easeInEaseOut: {} } } },
    "react-native-reanimated": { default: { View: "ReanimatedView", FlatList: "NativeFlatList" }, Easing: { out: passthrough, cubic: {} }, LinearTransition: motion, Keyframe: class { duration() { return motion; } }, FadeIn: motion, ReduceMotion: { System: "system" } },
    "@expo/vector-icons": { Feather: "Icon" }, "expo-haptics": { impactAsync: async () => {}, selectionAsync: async () => {} }, "expo-router": { router: {} },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 59, bottom: 34 }) },
    "react-native-gesture-handler": { GestureDetector: "GestureDetector", Gesture: { Pinch: () => ({ onEnd: () => ({ runOnJS: () => ({}) }) }) } },
    "@react-native-async-storage/async-storage": { default: { getItem: async (key: string) => storage.get(key) ?? null, setItem: async (key: string, value: string) => { storage.set(key, value); } } },
    "@/components/AppPopupProvider": { useAppPopup: () => ({ showPopup: () => {} }) },
    "@/components/MyDayRow": { MyDayRow: "MyDayRow", myDayRowStyles: {} },
    "@/context/AppContext": { useAppContextSelector: (select: any) => select(context) },
    "@/constants/colors": { useTheme: () => ({ primary: "#ffffff" }) },
    "@/constants/designTokens": { spacing: { md: 12, lg: 16 }, motion: { standard: 220 }, radii: { card: 22 }, typography: {} },
    "@/constants/featureAvailability": { isPointsVisible: () => false },
    "@/hooks/useAccessibilityPreferences": { useAccessibilityPreferences: () => ({ reduceMotion }) },
    "@/hooks/useChoreLifecycleNow": { useChoreLifecycleNow: () => new Date() },
    "@/hooks/useCompletionFeedback": { useCompletionFeedback: () => ({ completingIds: new Set() }) },
    "@/hooks/useHomeSections": { useHomeSections: () => ({ expandedHomeSections: { schedule: true, "my-chores": true, shopping: true }, toggleSection: () => {} }) },
    "@/hooks/useFloatingWeekCalendar": { useFloatingWeekCalendar: () => ({ height: 170, onScroll: () => {}, onCalendarLayout: () => {}, spacerStyle: {}, floatingStyle: {} }) },
    "@/hooks/useModalDismissal": { useModalDismissal: () => ({ dismiss: () => {} }) },
    "@/hooks/useDraggableSheet": { useDraggableSheet: () => ({}) },
    "@/lib/homeFocus": { isHomeCaughtUp: () => true, selectUpNextChore: () => undefined },
    "@/lib/upcomingChores": { upcomingHouseholdChores: empty },
    "@/lib/choreLifecycle": choreLifecycle,
    "@/lib/chorePermissions": chorePermissions,
    "@/lib/choreOccurrences": { isChoreActiveOnDay, choreLocalDateKey, choreScheduledDate },
    "@/lib/choreTimezone": { householdDateKey },
    "@/lib/personalSchedule": { scheduleDateKey: (date: Date) => date.toISOString().slice(0, 10) },
    "@/lib/calendarItems": { deriveCalendarItems: empty, groupCalendarItemsByDate: () => new Map(), localDateKey: (date: Date) => date.toISOString().slice(0, 10) },
    "@/lib/overdueDisplay": { compactOverdueItems: (items: any) => ({ visibleItems: items }) },
    "@/lib/externalTasks": { getExternalTaskDestination: async () => null },
    "@/lib/runtimeDiagnostics": { reportRuntimeError: () => {} },
    "@/lib/haptics": { tapLight: () => {} },
  };
  const load = (file: string) => {
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: false, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const output: any = {};
    runInNewContext(code, { exports: output, Date, Map, Set, Promise, JSON, Math, setTimeout, clearTimeout, require: (name: string) => {
      if (name in modules) return modules[name];
      if (name.startsWith("@/components/")) { const key = name.split("/").at(-1)!; return { [key]: key, useFloatingActionMetrics: () => ({ scrollBottomPadding: 100 }) }; }
      if (name.startsWith("@/lib/")) return {};
      throw Error(`Unexpected screen dependency ${name}`);
    } });
    return output;
  };
  modules["@/hooks/useHomeSummaryDismissal"] = load("hooks/useHomeSummaryDismissal.ts");
  modules["@/lib/pinchListView"] = { resolvePinchView: () => "list" };
  modules["@/components/PinchListView"] = load("components/PinchListView.tsx");
  modules["@/components/HomeCalendarPresentation"] = load("components/HomeCalendarPresentation.tsx");
  const screen = load("app/(tabs)/index.tsx").default;
  const render = () => { cursor = 0; const tree = screen(); pending.splice(0).forEach(fn => fn()); return tree; };
  const all = () => children(render());
  const summary = () => all().find(node => typeof node.type === "function" && node.type.name === "TodayFocusCard");
  const list = () => all().find(node => node.type === "NativeFlatList")!;
  const attached = () => all().filter(node => node.props.testID === "home-attached-week-calendar");
  const calendarSections = () => all().filter(node => typeof node.type === "function" && node.type.name === "HomeCalendarSection");
  const inlineCalendar = () => calendarSections().some(node => !node.props.dismissed);
  return { render, all, summary, list, attached, inlineCalendar, context, storage };
}
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
{
  const f = fixture(); f.render(); await settle();
  const before = f.list(); assert(f.summary()); assert(f.inlineCalendar());
  f.summary()!.props.onDismiss();
  assert.equal(f.summary(), undefined, "X removes the summary in the real home screen");
  assert.equal(f.inlineCalendar(), false, "X must remove the active Calendar divider/card branch");
  assert.equal(f.attached().length, 1, "X mounts one attached calendar under the greeting");
  assert.notEqual(f.list().key, before.key, "the native VirtualizedList header cell must be replaced, not reused with the old calendar subtree");
}
{
  const f = fixture(true); f.render(); await settle(); f.render();
  assert.equal(f.summary(), undefined, "restoring compact/list mode hides the summary");
  assert.equal(f.inlineCalendar(), false, "a saved compact layout must not leave the horizontal Calendar bar/card active");
  assert.equal(f.attached().length, 1, "restored compact mode uses the same attached calendar as pressing X");
}
{
  const f = fixture(false, true); f.render(); await settle(); f.render();
  assert.equal(f.summary(), undefined);
  assert.equal(f.inlineCalendar(), false);
  assert.equal(f.attached().length, 1, "a cold launch with today's dismissal must restore the header");
}
{
  const f = fixture(false, false, true); f.render(); await settle();
  f.summary()!.props.onDismiss();
  assert.equal(f.summary(), undefined);
  assert.equal(f.attached().length, 1, "reduced motion cannot block the header transition");
}
{
  const f = fixture(); f.render(); await settle(); f.summary()!.props.onDismiss(); await settle();
  const previous = f.list().key;
  f.context.householdId = "second-home"; f.render(); await settle();
  assert(f.summary(), "a different household restores its own summary choice");
  assert.equal(f.attached().length, 0);
  assert.notEqual(f.list().key, previous, "another household cannot reuse the previous household's native header cell");
  f.context.householdId = "home"; f.render(); await settle();
  assert.equal(f.attached().length, 1, "returning to the first household restores its saved header");
}
{
  const f = fixture();
  const now = new Date(), yesterday = new Date(now.getTime() - 86400000);
  const finished = { id: "finished-today", title: "Finished today", assignedTo: "avery", householdId: "home", completed: true, completedAt: now.toISOString(), dueDate: now.toISOString(), scheduledDate: householdDateKey(now, "UTC") };
  f.context.chores = [finished]; f.render(); await settle();
  assert.equal(f.summary()!.props.completedCount, 1, "completed work must remain in today's progress numerator");
  assert.equal(f.summary()!.props.totalCount, 1, "checking off the last chore must show 1/1, not 0/0");
  f.context.chores = [{ ...finished, completed: false, completedAt: undefined }];
  assert.equal(f.summary()!.props.remainingCount, 1);
  assert.equal(f.summary()!.props.completedCount, 0);
  assert.equal(f.summary()!.props.totalCount, 1, "undoing completion keeps the total stable");
  f.context.chores = [{ ...finished, completedAt: yesterday.toISOString() }];
  assert.equal(f.summary()!.props.totalCount, 0, "yesterday's completion must not inflate today's progress");
  f.context.chores = [{ ...finished, skippedAt: now.toISOString() }];
  assert.equal(f.summary()!.props.totalCount, 0, "skipped occurrences are not completed work");
}
console.log("Full home screen passes calendar transitions, saved preferences, household switching and stable completed/undone progress totals.");
