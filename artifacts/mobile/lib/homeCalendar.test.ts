import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as scrollIntent from "./floatingCalendarScroll.ts";

function hooks() {
  const values: any[] = [], effects: { dependencies: any[]; cleanup?: () => void }[] = [];
  let cursor = 0;
  const pending: (() => void)[] = [];
  const useState = (initial: any) => {
    const slot = cursor++;
    if (!(slot in values)) values[slot] = typeof initial === "function" ? initial() : initial;
    return [values[slot], (value: any) => { values[slot] = typeof value === "function" ? value(values[slot]) : value; }];
  };
  return {
    useState, useRef: (value: any) => useState(() => ({ current: value }))[0],
    useEffect: (effect: () => (() => void) | void, dependencies: any[]) => {
      const slot = cursor++;
      const previous = effects[slot];
      if (previous && previous.dependencies.length === dependencies.length && dependencies.every((value, index) => Object.is(value, previous.dependencies[index]))) return;
      pending.push(() => { previous?.cleanup?.(); effects[slot] = { dependencies, cleanup: effect() || undefined }; });
    },
    render: <T>(run: () => T): T => { cursor = 0; const value = run(); pending.splice(0).forEach(effect => effect()); return value; },
    unmount: () => effects.forEach(effect => effect?.cleanup?.()),
  };
}
function load(name: string, modules: Record<string, any>) {
  const source = readFileSync(resolve(process.cwd(), `hooks/${name}.ts`), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: any = {};
  runInNewContext(compiled, { exports, require: (key: string) => { assert(key in modules, `Unexpected hook dependency ${key}`); return modules[key]; } });
  return exports[name];
}
async function settle() { for (let step = 0; step < 12; step++) await Promise.resolve(); }
const storage = new Map<string, string>();
const reads: { key: string; resolve: (value: string | null) => void }[] = [];
let delayReads = false, failWrites = false;
const errors: string[] = [];
function dismissal() {
  const react = hooks();
  const hook = load("useHomeSummaryDismissal", {
    react,
    "@react-native-async-storage/async-storage": { default: {
      getItem: (key: string) => delayReads ? new Promise(resolve => reads.push({ key, resolve })) : Promise.resolve(storage.get(key) ?? null),
      setItem: async (key: string, value: string) => { if (failWrites) throw Error("offline storage"); storage.set(key, value); },
    } },
    "@/lib/runtimeDiagnostics": { reportRuntimeError: (action: string) => errors.push(action) },
  });
  return { render: (userId = "avery", householdId: string | null = "home", day = "2026-11-25") => react.render(() => hook({ userId, householdId, day })), unmount: react.unmount };
}
const first = dismissal();
assert.equal(first.render().dismissed, false);
await settle();
first.render().dismiss(); await settle();
assert.equal(first.render().dismissed, true, "the X must choose the attached calendar immediately");
first.unmount();
const restored = dismissal(); restored.render(); await settle();
assert.equal(restored.render().dismissed, true, "a native screen remount must retain dismissal for this day");
assert.equal(restored.render("blake").dismissed, false, "another person must not inherit Avery's dismissal");
await settle();
assert.equal(restored.render("avery", "another-home").dismissed, false, "another household must not inherit dismissal");
assert.equal(restored.render("avery", "home", "2026-11-26").dismissed, false, "a new day starts with its summary available");
restored.unmount();

delayReads = true;
const late = dismissal(); late.render("blake");
late.render("blake").dismiss(); await settle();
reads.splice(0).forEach(read => read.resolve(null)); await settle();
assert.equal(late.render("blake").dismissed, true, "a slow old storage read must not undo a fresh X press");
late.render("avery", "other-home");
late.render("blake", "other-home");
const switchedReads = reads.splice(0);
switchedReads[0].resolve("2026-11-25"); await settle();
assert.equal(late.render("blake", "other-home").dismissed, false, "a previous account's delayed read must not restore this account's dismissal");
switchedReads[1].resolve(null); await settle();
assert.equal(late.render("blake", "other-home").dismissed, false);
late.unmount(); delayReads = false;
failWrites = true;
const failed = dismissal(); failed.render("avery", "failed-storage"); await settle();
failed.render("avery", "failed-storage").dismiss(); await settle();
assert.equal(failed.render("avery", "failed-storage").dismissed, true, "a storage failure must not block the visible layout change");
assert(errors.includes("save summary dismissal")); failed.unmount(); failWrites = false;

const react = hooks();
const timings: { value: number; duration: number }[] = [];
const hook = load("useFloatingWeekCalendar", {
  react,
  "@/lib/floatingCalendarScroll": scrollIntent,
  "react-native-reanimated": {
    useSharedValue: (value: any) => react.useState(() => ({ value }))[0],
    useAnimatedStyle: (value: any) => value,
    useAnimatedScrollHandler: (callback: any) => callback,
    runOnJS: (callback: any) => callback,
    withTiming: (value: number, options: { duration: number }) => { timings.push({ value, duration: options.duration }); return value; },
    Easing: { inOut: () => null, out: () => null, cubic: null },
  },
});
const render = (enabled = true, reduceMotion = false) => react.render(() => hook({ enabled, reduceMotion, resetKey: "avery:home:2026-11-25" }));
let calendar = render();
calendar.onCalendarLayout({ nativeEvent: { layout: { height: 170 } } });
calendar = render();
const scroll = (offset: number) => calendar.onScroll({ contentOffset: { y: offset }, contentSize: { height: 978 }, layoutMeasurement: { height: 800 } });
scroll(8); calendar = render();
assert.equal(calendar.hidden, true, "scrolling down must hide an already-attached calendar without waiting for its full height");
assert.equal(calendar.spacerStyle().height, 0, "the reserved calendar space must collapse along with the overhang");
assert.equal(calendar.floatingStyle().transform[0].translateY, -186);
assert.equal(timings.at(-1)?.duration, 360, "hiding retains the slower graceful motion");
scroll(6); calendar = render(); assert.equal(calendar.hidden, true, "small scroll jitter must not flicker the calendar");
scroll(0); calendar = render();
assert.equal(calendar.hidden, false);
assert.equal(calendar.spacerStyle().height, 170, "scrolling up must restore the space above chores");
assert.equal(timings.at(-1)?.duration, 260);
scroll(178); calendar = render();
calendar.onScroll({ contentOffset: { y: 8 }, contentSize: { height: 808 }, layoutMeasurement: { height: 800 } });
calendar = render();
assert.equal(calendar.hidden, true, "a bottom offset clamped by collapsing content must not masquerade as an upward gesture");
calendar = render(false); scroll(100); calendar = render(false); assert.equal(calendar.hidden, false, "the inline calendar must ignore attached scrolling behavior");
calendar = render(true, true); scroll(120); calendar = render(true, true);
assert.equal(calendar.hidden, true);
assert.equal(calendar.floatingStyle().opacity, 0, "reduced motion must hide without a slide animation");
assert.equal(calendar.floatingStyle().transform[0].translateY, 0);
assert.equal(calendar.spacerStyle().height, 0);
console.log("Home calendar dismissal restoration, account/day isolation, stale storage, failure recovery, attached scroll and spacing tests passed.");
