import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { SaveFeedbackStore } from "./saveFeedback.ts";
const store = new SaveFeedbackStore();
store.setScope("actor:home");
const states: any[] = [],
  effects: any[] = [],
  pending: (() => void)[] = [],
  timers = new Map<number, () => void>();
let cursor = 0,
  timer = 0;
const react = {
  useState: (initial: any) => {
    const i = cursor++;
    if (!(i in states)) states[i] = initial;
    return [
      states[i],
      (value: any) => {
        states[i] = value;
      },
    ];
  },
  useSyncExternalStore: (_subscribe: any, get: any) => get(),
  useEffect: (fn: any, deps: any[]) => {
    const i = cursor++,
      prior = effects[i];
    if (!prior || deps.some((value, n) => !Object.is(value, prior.deps[n])))
      pending.push(() => {
        prior?.cleanup?.();
        effects[i] = { deps, cleanup: fn() };
      });
  },
};
const modules: any = {
  react,
  "react/jsx-runtime": {
    jsx: (type: any, props: any) => ({ type, props }),
    jsxs: (type: any, props: any) => ({ type, props }),
  },
  "react-native": {
    View: "View",
    Text: "Text",
    StyleSheet: { create: (v: any) => v },
  },
  "expo-router": {},
  "react-native-safe-area-context": {},
  "@/components/GlassButton": { GlassButton: "GlassButton" },
  "@/context/AppContext": {},
  "@/constants/colors": {
    useTheme: () => ({
      card: "#181818",
      border: "#444",
      foreground: "#fff",
      destructive: "#e88",
      mutedForeground: "#bbb",
    }),
  },
  "@/lib/saveFeedback": { saveFeedback: store },
};
const exports: any = {};
const code = ts.transpileModule(
  readFileSync("components/SaveFeedbackNotice.tsx", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
runInNewContext(code, {
  exports,
  Set,
  clearTimeout: (id: number) => timers.delete(id),
  setTimeout: (fn: () => void, ms: number) => {
    assert.equal(ms, 300);
    timers.set(++timer, fn);
    return timer;
  },
  require: (name: string) => {
    assert(name in modules, name);
    return modules[name];
  },
});
const render = () => {
  cursor = 0;
  const result = exports.SaveFeedbackNotice({
    scope: "actor:home",
    inline: true,
  });
  pending.splice(0).forEach((fn) => fn());
  return result;
};
const nodes = (v: any): any[] =>
  !v
    ? []
    : Array.isArray(v)
      ? v.flatMap(nodes)
      : typeof v !== "object"
        ? []
        : [v, ...nodes(v.props?.children)];
const text = (v: any): string =>
  v == null
    ? ""
    : Array.isArray(v)
      ? v.map(text).join(" ")
      : typeof v === "object"
        ? text(v.props?.children)
        : String(v);
assert.equal(render(), null);
let ticket: any,
  attempts = 0;
const begin = async () => {
  attempts++;
  ticket = store.begin("actor:home", "shopping", "Shopping", begin);
};
await begin();
assert.equal(
  render(),
  null,
  "fast saves must not flash loading over the checkmark",
);
[...timers.values()].forEach((fn) => fn());
assert.match(text(render()), /Saving changes/);
store.finish(ticket, true);
let tree = render();
assert.match(text(tree), /Save not confirmed.*Shopping/);
assert(nodes(tree).some((node) => node.props?.accessibilityRole === "alert"));
const retryButton = nodes(tree).find(
  (node) => node.props?.accessibilityLabel === "Retry failed saves",
);
assert(retryButton);
retryButton.props.onPress();
assert.equal(attempts, 2);
assert.equal(store.getSnapshot().issues[0].phase, "pending");
store.finish(ticket);
assert.equal(render(), null);
console.log(
  "Save notice: brief-save delay, accessible pending/failed text, real Retry action and acknowledgement dismissal passed.",
);
