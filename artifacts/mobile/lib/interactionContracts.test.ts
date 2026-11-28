import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Duplicate sibling keys can retain stale modal portals and trap focus. Check
// all explicit JSX siblings, including conditionally rendered components.
function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(path, entry.name)) : entry.name.endsWith(".tsx") ? [join(path, entry.name)] : []);
}
for (const path of [...files("app"), ...files("components")]) {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const childElements = (node: ts.Node): ts.JsxOpeningLikeElement[] => {
    if (ts.isJsxElement(node)) return [node.openingElement];
    if (ts.isJsxSelfClosingElement(node)) return [node];
    if (ts.isJsxExpression(node) && node.expression) return childElements(node.expression);
    if (ts.isParenthesizedExpression(node)) return childElements(node.expression);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return childElements(node.right);
    if (ts.isConditionalExpression(node)) return [...childElements(node.whenTrue), ...childElements(node.whenFalse)];
    return [];
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const keys = new Set<string>();
      for (const child of node.children) {
        // Branches of one conditional are mutually exclusive; compare their
        // possible keys against other sibling positions, not against each other.
        const possibleKeys = new Set(childElements(child).flatMap(element => {
          const attribute = element.attributes.properties.find((prop): prop is ts.JsxAttribute => ts.isJsxAttribute(prop) && prop.name.getText(source) === "key");
          return attribute?.initializer ? [attribute.initializer.getText(source).replace(/\s/g, "")] : [];
        }));
        for (const key of possibleKeys) {
          assert(!keys.has(key), `${path}: duplicate explicit sibling key ${key}`);
          keys.add(key);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

// An action failure must never permanently disable the shared Add button.
const exports: any = {}, refs: any[] = [], timers: Array<() => void> = [];
let cursor = 0, calls = 0;
const jsx = (type: any, props: any) => ({ type, props });
const code = ts.transpileModule(readFileSync("components/FloatingActionButton.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: false, jsx: ts.JsxEmit.ReactJSX } }).outputText;
runInNewContext(code, { exports, setTimeout: (callback: () => void) => timers.push(callback), require: (name: string) => {
  if (name === "react") return { useRef: (value: any) => refs[cursor++] ??= { current: value } };
  if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
  if (name === "react-native") return { StyleSheet: { create: (value: any) => value, absoluteFill: {} } };
  if (name === "@expo/vector-icons") return { Feather: "Icon" };
  if (name === "@/components/GlassControlSurface") return { GlassControlSurface: "Surface" };
  if (name === "@/components/SmoothPressable") return { SmoothPressable: "Button" };
  if (name === "@/constants/colors") return { useTheme: () => ({ foreground: "#fff" }) };
  if (name === "@/hooks/useTabBarLayout") return { useTabBarLayout: () => ({ tabBarInset: 60 }) };
  throw Error(name);
} });
const render = () => { cursor = 0; return exports.FloatingActionButton({ accessibilityLabel: "Add", onPress: () => { calls++; if (calls === 1) throw Error("fixture failure"); } }); };
assert.throws(() => render().props.onPress(), /fixture failure/);
render().props.onPress(); assert.equal(calls, 1, "rapid taps remain locked");
while (timers.length) timers.shift()!();
render().props.onPress(); assert.equal(calls, 2, "retry works after a throwing consumer");
console.log("JSX modal identities and shared Add-button failure recovery passed");

// Execute recovery controls without crashing the running preview or reloading a device.
{
  const fallbackModule: any = {}, state: any[] = [];
  let slot = 0, reloads = 0, resets = 0, rejectReload = false;
  const code = ts.transpileModule(readFileSync("components/ErrorFallback.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: false, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, { exports: fallbackModule, __DEV__: true, console: { error() {} }, require: (name: string) => {
    if (name === "react") return { useState: (initial: any) => { const index = slot++; if (!(index in state)) state[index] = initial; return [state[index], (next: any) => { state[index] = next; }]; } };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "expo") return { reloadAppAsync: async () => { reloads++; if (rejectReload) throw Error("reload unavailable"); } };
    if (name === "react-native") return { View: "View", Text: "Text", Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", Platform: { select: () => "monospace" }, StyleSheet: { create: (value: any) => value } };
    if (name === "@expo/vector-icons") return { Feather: "Icon" };
    if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
    if (name === "@/constants/colors") return { colorSchemes: { mono: {} } };
    throw Error(name);
  } });
  const render = () => { slot = 0; return fallbackModule.ErrorFallback({ error: new Error("controlled fixture"), componentStack: "fixture stack", resetError: () => { resets++; } }); };
  const nodes = (node: any): any[] => node && typeof node === "object" && node.props ? [node, ...[node.props.children].flat(Infinity).flatMap(nodes)] : [];
  const text = (node: any): string => typeof node === "string" ? node : node?.props ? [node.props.children].flat(Infinity).map(text).join("") : "";
  nodes(render()).find(node => node.props.accessibilityLabel === "View error details").props.onPress();
  assert.equal(nodes(render()).find(node => node.type === "Modal").props.visible, true);
  nodes(render()).find(node => node.props.accessibilityLabel === "Close error details").props.onPress();
  assert.equal(nodes(render()).find(node => node.type === "Modal").props.visible, false);
  const retry = () => nodes(render()).find(node => node.type === "Pressable" && text(node) === "Try Again").props.onPress();
  await retry(); assert.equal(reloads, 1); assert.equal(resets, 0);
  rejectReload = true; await retry(); assert.equal(resets, 1, "failed native reload still resets the error boundary for another attempt");
}
console.log("Error fallback detail controls, restart request and failed-restart recovery passed");
