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
const sources: Record<string, string> = Object.fromEntries(["LiquidGlass", "Surface", "GlassControlSurface", "GlassModalSurface"].map((name) => [name,
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
  const controls = evaluate("GlassControlSurface");
  const popups = evaluate("GlassModalSurface");
  return {
    colors, reduce: (value: boolean) => { reduced = value; }, calls: () => availabilityCalls,
    surface: (props: Record<string, any> = {}) => host(surface.Surface(props)),
    glass: (props: Record<string, any> = {}) => host(glass.GlassSurface(props)),
    sheet: (props: Record<string, any> = {}) => host(glass.GlassSheet(props)),
    tabBar: (props: Record<string, any> = {}) => host(glass.GlassTabBar(props)),
    chip: (props: Record<string, any> = {}) => host(glass.AccentChip(props)),
    control: (props: Record<string, any> = {}) => host(controls.GlassControlSurface(props)),
    popup: (props: Record<string, any> = {}) => host(popups.GlassModalSurface(props)),
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
    solid(view.surface({ level: "modal", children: child }), view.colors.surfaceModalOpaque, `${context}: modal`);
    solid(view.sheet({ children: child }), view.colors.surfaceModalOpaque, `${context}: sheet`);
    solid(view.popup({ children: child }), view.colors.surfaceModalOpaque, `${context}: popup`);
    solid(view.popup({ destructive: true, children: child }), view.colors.destructiveSurfaceOpaque, `${context}: destructive popup`);
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
solid(ios.surface({ material: "glass", children: child }), ios.colors.card, "content cannot opt back into glass");
solid(ios.glass({ variant: "elevated", children: child }), ios.colors.cardElevated, "generic surface defaults to solid");
assert.equal(ios.control({ children: child }).type, "GlassView", "button controls retain native glass");
assert.equal(ios.tabBar({ children: child }).type, "GlassView");
solid(ios.surface({ level: "modal", material: "solid", children: child }), ios.colors.surfaceModalOpaque, "explicit solid modal");
solid(ios.glass({ variant: "destructive", material: "solid", children: child }), ios.colors.destructiveSurfaceOpaque, "explicit solid destructive");
solid(ios.surface({ level: "modal", variant: "regular", children: child }), ios.colors.card, "variant overrides level");

for (const [os, available, api] of platforms) {
  const view = renderer(os, available, api);
  for (const variant of ["modal", "destructive"] as const) {
    const fill = variant === "modal" ? view.colors.surfaceModalOpaque : view.colors.destructiveSurfaceOpaque;
    for (const reduced of [false, true]) {
      view.reduce(reduced);
      solid(view.surface({ variant, children: child }), fill, `${os}/${variant}/reduced=${reduced}: content sheet`);
      solid(view.sheet({ variant, children: child }), fill, `${os}/${variant}/reduced=${reduced}: shared sheet`);
    }
  }
}
solid(ios.sheet({ children: child }), ios.colors.surfaceModalOpaque, "shared sheet defaults to solid");
ios.reduce(true);
assert.equal(ios.control({ children: child }).type, "View", "reduced transparency disables native button glass");
// Floating controls retain readable fallback fills on every supported platform.
for (const [os, available, api] of platforms) {
  const view = renderer(os, available, api);
  const control = nodes(view.control({ pointerEvents: "none", children: child }));
  assert.equal(control.some(node => flatten(node.props.style).backdropFilter), os === "web", "web floating controls must blur behind sharp labels");
  view.reduce(true);
  const fallback = nodes(view.control({ pointerEvents: "none", children: child }));
  assert(!fallback.some(node => node.type === "GlassView" || node.type === "BlurView" || flatten(node.props.style).backdropFilter), "reducing transparency removes blur from floating controls");
  assert(fallback.some(node => flatten(node.props.style).backgroundColor === view.colors.cardElevated), "floating controls keep an opaque semantic fill when transparency is reduced");
}
console.log("surface appearance renderer tests passed: all content/cards/sheets stay solid and button/navigation controls retain accessible glass.");
