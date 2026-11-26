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
  const childElement = (node: ts.Node): ts.JsxOpeningLikeElement | undefined => {
    if (ts.isJsxElement(node)) return node.openingElement;
    if (ts.isJsxSelfClosingElement(node)) return node;
    if (ts.isJsxExpression(node) && node.expression) return childElement(node.expression);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return childElement(node.right);
    return undefined;
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const keys = new Set<string>();
      for (const child of node.children) {
        const element = childElement(child);
        const attribute = element?.attributes.properties.find((prop): prop is ts.JsxAttribute => ts.isJsxAttribute(prop) && prop.name.getText(source) === "key");
        if (!attribute?.initializer) continue;
        const key = attribute.initializer.getText(source).replace(/\s/g, "");
        assert(!keys.has(key), `${path}: duplicate explicit sibling key ${key}`);
        keys.add(key);
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
