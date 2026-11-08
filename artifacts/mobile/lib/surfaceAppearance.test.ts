import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { colorSchemes, resolveThemeTokens } from "../constants/themeTokens.ts";
import * as designTokens from "../constants/designTokens.ts";

type Node = { type: string | ((props: Record<string, any>) => Node); props: Record<string, any> };
const registeredStyles = new Map([[73, { backgroundColor: "#123456", padding: 22 }]]);
function flatten(style: any): Record<string, any> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
  return typeof style === "number" ? registeredStyles.get(style) ?? {} : style || {};
}
function host(node: Node): Node { return typeof node.type === "function" ? host(node.type(node.props)) : node; }
function nodes(node: Node): Node[] {
  const children = [node.props.children].flat(Infinity).filter((child) => child && typeof child === "object" && "type" in child);
  return [node, ...children.flatMap((child) => nodes(host(child)))];
}
const opaque = (color: unknown) => typeof color === "string" && /^#[\da-f]{6}$/i.test(color);
const sources: Record<string, string> = Object.fromEntries(["LiquidGlass", "Surface"].map((name) => [name,
  ts.transpileModule(readFileSync(resolve(process.cwd(), "components", `${name}.tsx`), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText,
]));

// Execute actual components, replacing only platform/vendor rendering. These
// tests inspect material, fill order and preserved props without native UI.
function renderer(os: "ios" | "android" | "web", available = true, api = true, mode: "dark" | "light" = "dark", scheme: keyof typeof colorSchemes = "mono") {
  let reduced = false;
  let availabilityCalls = 0;
  const colors = resolveThemeTokens(mode, scheme);
  const jsx = (type: Node["type"], props: Node["props"]): Node => ({ type, props });
  const modules: Record<string, unknown> = {
    react: {}, "react/jsx-runtime": { jsx, jsxs: jsx },
    "expo-blur": { BlurView: "BlurView" },
    "expo-glass-effect": {
      GlassView: "GlassView",
      isLiquidGlassAvailable: () => { availabilityCalls++; return available; },
      isGlassEffectAPIAvailable: () => { availabilityCalls++; return api; },
    },
    "react-native": { Platform: { OS: os }, View: "View", Pressable: "Pressable", StyleSheet: {
      create: (styles: unknown) => styles, flatten, hairlineWidth: 1,
      absoluteFill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
    } },
    "@/lib/ripple": { androidRipple: () => undefined },
    "@/constants/colors": { useTheme: () => colors },
    "@/constants/designTokens": designTokens,
    "@/hooks/useAccessibilityPreferences": { useAccessibilityPreferences: () => ({ reduceTransparency: reduced, reduceMotion: false }) },
  };
  function evaluate(name: string) {
    const exports: Record<string, any> = {};
    runInNewContext(sources[name], { exports, require: (name: string) => { assert(name in modules, `unexpected dependency ${name}`); return modules[name]; } });
    return exports;
  }
  const glass = evaluate("LiquidGlass");
  modules["@/components/LiquidGlass"] = glass;
  const surface = evaluate("Surface");
  return {
    colors, reduce: (value: boolean) => { reduced = value; }, calls: () => availabilityCalls,
    surface: (props: Record<string, any> = {}) => host(surface.Surface(props)),
    glass: (props: Record<string, any> = {}) => host(glass.GlassSurface(props)),
    sheet: (props: Record<string, any> = {}) => host(glass.GlassSheet(props)),
    tabBar: (props: Record<string, any> = {}) => host(glass.GlassTabBar(props)),
    chip: (props: Record<string, any> = {}) => host(glass.AccentChip(props)),
  };
}
const child: Node = { type: "Text", props: { children: "Shopping fixture" } };
function solid(node: Node, fill: string, context: string) {
  assert.equal(node.type, "View", `${context}: stable host renderer`);
  assert.equal(flatten(node.props.style).backgroundColor, fill, `${context}: stable semantic fill`);
  assert(opaque(fill), `${context}: opaque fill`);
  const tree = nodes(node);
  assert(!tree.some((node) => node.type === "GlassView" || node.type === "BlurView"), `${context}: no adaptive material`);
  assert.equal(tree.filter((node) => node.type === "View").length, 1, `${context}: no second tint overlay`);
  assert.equal(node.props.children, child, `${context}: children retained`);
}
const platforms = [
  ["ios", true, true], ["ios", false, true], ["ios", true, false], ["ios", false, false],
  ["android", false, false], ["web", false, false],
] as const;
for (const [os, available, api] of platforms) {
  const view = renderer(os, available, api);
  for (const reduced of [false, true, false]) {
    view.reduce(reduced);
    const context = `${os}, native=${available}/${api}, reduced=${reduced}`;
    solid(view.surface({ children: child }), view.colors.card, `${context}: default`);
    solid(view.surface({ level: "subtle", children: child }), view.colors.cardSubtle, `${context}: subtle`);
    solid(view.surface({ level: "elevated", children: child }), view.colors.cardElevated, `${context}: elevated`);
    solid(view.chip({ children: child }), view.colors.card, `${context}: chip`);
  }
  assert.equal(view.calls(), 0, "solid cards must never query native glass availability");
}
for (const mode of ["dark", "light"] as const) {
  for (const scheme of Object.keys(colorSchemes) as (keyof typeof colorSchemes)[]) {
    const view = renderer("web", false, false, mode, scheme);
    solid(view.surface({ children: child }), view.colors.card, `${mode}/${scheme}: card`);
    solid(view.surface({ level: "subtle", children: child }), view.colors.cardSubtle, `${mode}/${scheme}: subtle`);
    solid(view.surface({ level: "elevated", children: child }), view.colors.cardElevated, `${mode}/${scheme}: elevated`);
  }
}

// Regression: caller black used to be painted over by a second background.
const ios = renderer("ios");
const onLayout = () => {};
const custom = ios.surface({ children: child, testID: "shopping", accessibilityLabel: "Groceries", onLayout, pointerEvents: "box-none",
  style: [[73, { borderRadius: 18 }], null, [{ marginTop: 7 }, { backgroundColor: "#000000" }]],
});
solid(custom, "#000000", "caller background");
assert.equal(flatten(custom.props.style).padding, 22);
assert.equal(flatten(custom.props.style).borderRadius, 18);
assert.equal(flatten(custom.props.style).marginTop, 7);
assert.equal(custom.props.testID, "shopping");
assert.equal(custom.props.accessibilityLabel, "Groceries");
assert.equal(custom.props.onLayout, onLayout);
assert.equal(custom.props.pointerEvents, "box-none");
assert.equal(ios.surface({ material: "glass", children: child }).type, "GlassView", "explicit glass override remains available");
assert.equal(ios.glass({ variant: "elevated", children: child }).type, "GlassView", "direct glass retains native navigation treatment");
assert.equal(ios.tabBar({ children: child }).type, "GlassView");
solid(ios.surface({ level: "modal", material: "solid", children: child }), ios.colors.surfaceModalOpaque, "explicit solid modal");
solid(ios.glass({ variant: "destructive", material: "solid", children: child }), ios.colors.destructiveSurfaceOpaque, "explicit solid destructive");
solid(ios.surface({ level: "modal", variant: "regular", children: child }), ios.colors.card, "variant overrides level");

for (const [os, available, api] of platforms) {
  const view = renderer(os, available, api);
  for (const variant of ["modal", "destructive"] as const) {
    const fill = variant === "modal" ? view.colors.surfaceModalOpaque : view.colors.destructiveSurfaceOpaque;
    const before = nodes(view.surface({ variant, children: child }));
    assert(!before.some((node) => node.type === "GlassView"), "sheets must not use native interactive glass");
    assert.equal(before.some((node) => node.type === "BlurView"), os === "ios", "iOS sheets retain blur");
    if (os === "web") assert(before.some((node) => flatten(node.props.style).backdropFilter), "web sheets retain frost");
    if (os === "android") assert(before.some((node) => flatten(node.props.style).backgroundColor === fill), "Android preserves semantic opaque fallback");
    view.reduce(true);
    const after = nodes(view.surface({ variant, children: child }));
    assert(!after.some((node) => node.type === "GlassView" || node.type === "BlurView"), "reduced transparency removes native glass/blur");
    assert(!after.some((node) => flatten(node.props.style).backdropFilter), "reduced transparency removes CSS frost");
    assert(after.some((node) => flatten(node.props.style).backgroundColor === fill), "reduced transparency preserves semantic fill");
    assert(opaque(fill));
    view.reduce(false);
  }
}
assert(nodes(ios.sheet({ children: child })).some((node) => node.type === "BlurView"), "GlassSheet defaults to frosted modal");
ios.reduce(true);
assert.equal(ios.glass({ variant: "elevated", children: child }).type, "View", "reduced transparency disables native navigation glass");
console.log("surface appearance renderer tests passed");
