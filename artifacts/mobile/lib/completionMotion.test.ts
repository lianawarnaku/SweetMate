import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(resolve(process.cwd(), "components/CompletionMotion.tsx"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: false, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function fixture(initialReduced = false) {
  let reduced = initialReduced, cursor = 0;
  const slots: any[] = [], effects: (() => void)[] = [], sequences: number[][] = [];
  const ref = (initial: any) => { const index = cursor++; return slots[index] ??= { current: initial }; };
  const react = {
    useRef: ref, useMemo: (fn: () => any) => fn(),
    useEffect: (effect: () => void, deps: any[]) => {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; });
      }
    },
  };
  const interpolate = (value: number, positions: number[], values: number[]) => {
    const next = positions.findIndex(position => position >= value);
    if (next <= 0) return next === 0 ? values[0] : values.at(-1)!;
    const t = (value - positions[next - 1]) / (positions[next] - positions[next - 1]);
    return values[next - 1] + t * (values[next] - values[next - 1]);
  };
  const jsx = (type: any, props: any) => ({ type, props });
  const modules: Record<string, any> = {
    react: { ...react, default: react }, "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { View: "View", Text: "Text", StyleSheet: { create: (x: any) => x, flatten: (x: any) => x } },
    "react-native-reanimated": { default: { View: "Animated.View" },
      cancelAnimation: () => {}, Easing: { out: (x: any) => x, in: (x: any) => x, inOut: (x: any) => x, cubic: "cubic", quad: "quad" },
      interpolate, LinearTransition: { duration: () => ({ easing: () => "layout" }) },
      useSharedValue: (value: number) => ref({ value }).current,
      useAnimatedStyle: (fn: () => any) => fn,
      withDelay: (_delay: number, value: number) => value, withTiming: (value: number) => value,
      withSequence: (...values: number[]) => { sequences.push(values); return values[0]; },
    },
    "@/hooks/useAccessibilityPreferences": { useAccessibilityPreferences: () => ({ reduceMotion: reduced }) },
    "@/constants/colors": { useTheme: () => ({ mutedForeground: "#888" }) },
  };
  const exports: any = {};
  runInNewContext(code, { exports, require: (name: string) => { assert(name in modules, name); return modules[name]; } });
  return {
    sequences,
    reduceMotion: () => { reduced = true; },
    render: (completed: boolean, departing = false) => {
      cursor = 0;
      const row = exports.CompletionMotion({ completed, departing, children: "Item" });
      while (effects.length) effects.shift()!();
      return { layout: row.props.layout, motion: row.props.style[1]() };
    },
  };
}
const fresh = fixture();
fresh.render(false);
assert.equal(fresh.sequences.length, 0, "opening a list cannot play completion feedback");
const checked = fresh.render(true);
assert.equal(fresh.sequences.length, 1, "a successful unchecked-to-checked transition plays one jiggle");
const transforms = checked.motion.transform;
assert(Math.abs(parseFloat(transforms.find((x: any) => x.rotate)?.rotate)) >= 1, "the row must visibly tilt rather than only changing its check icon");
assert(Math.abs(transforms.find((x: any) => x.translateX)?.translateX) >= 1, "the whole row must visibly jiggle sideways");
fresh.render(true);
assert.equal(fresh.sequences.length, 1, "rerenders cannot repeat a completed row's jiggle");
fresh.render(false);
assert.equal(fresh.sequences.length, 1, "unchecking cannot replay the success celebration");
fresh.render(true);
assert.equal(fresh.sequences.length, 2, "checking again after undo plays fresh feedback");
const history = fixture(); history.render(true);
assert.equal(history.sequences.length, 0, "already-completed history stays still on mount");
const accessible = fixture(true); accessible.render(false);
const reduced = accessible.render(true, true);
assert.equal(accessible.sequences.length, 0, "Reduce Motion skips the jiggle and departure animation");
assert.equal(reduced.layout, undefined);
assert(reduced.motion.transform.every((value: any) => value.translateX === 0 || value.translateY === 0 || value.rotate === "0deg" || value.scaleX === 1 || value.scaleY === 1));
fresh.reduceMotion();
fresh.render(false); fresh.render(true);
assert.equal(fresh.sequences.length, 2, "turning Reduce Motion on also stops future celebrations");
console.log("Shared completion motion tests passed: visible row feedback, history, rerenders, undo, repeat completion and Reduce Motion.");
