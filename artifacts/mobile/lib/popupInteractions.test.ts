import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type Node = { type: string; props: Record<string, any> };
function fixture() {
  const values: any[] = []; let cursor = 0;
  const useState = (initial: any) => { const i = cursor++; if (!(i in values)) values[i] = initial; return [values[i], (next: any) => { values[i] = typeof next === "function" ? next(values[i]) : next; }]; };
  const react = { useState, useRef: (value: any) => useState({ current: value })[0], useCallback: (fn: any) => fn,
    useMemo: (fn: any) => fn(), createContext: () => ({ Provider: "Provider" }), useContext: () => null };
  const jsx = (type: string, props: Record<string, any>) => ({ type, props });
  const code = ts.transpileModule(readFileSync("components/AppPopupProvider.tsx", "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, esModuleInterop: false, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports: any = {};
  runInNewContext(code, { exports, require: (name: string) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "react-native") return { ActivityIndicator: "Spinner", Modal: "Modal", Pressable: "Pressable", Text: "Text", View: "View", StyleSheet: { create: (s: any) => s } };
    if (name === "@expo/vector-icons") return { Feather: "Icon" };
    if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ bottom: 0 }) };
    if (name === "@/constants/colors") return { useTheme: () => ({}) };
    if (name === "@/components/GlassModalSurface") return { GlassModalBackdrop: "Backdrop", GlassModalSurface: "Surface" };
    if (name === "@/components/GlassButton") return { GlassButton: "Button" };
    throw Error(name);
  } });
  const render = (): Node => { cursor = 0; return exports.AppPopupProvider({ children: null }); };
  const nodes = (node: Node): Node[] => [node, ...[node.props.children].flat(Infinity).filter(value => value && typeof value === "object" && "props" in value).flatMap(nodes)];
  return { api: () => render().props.value, render,
    modal: () => nodes(render()).find(n => n.type === "Modal")!,
    text: () => nodes(render()).filter(n => n.type === "Text").map(n => n.props.children).join(" "),
    press: (label: string) => { const button = nodes(render()).find(n => n.type === "Button" && n.props.accessibilityLabel === label); assert(button, label); return button.props.onPress; },
  };
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
{
  const f = fixture(); let runs = 0, done!: () => void;
  const pending = new Promise<void>(resolve => { done = resolve; });
  f.api().showPopup({ title: "First", message: "", actions: [{ label: "Save", onPress: () => { runs++; return pending; } }] });
  const press = f.press("Save"); press(); press();
  assert.equal(runs, 1, "two taps before React rerenders cannot execute the same popup action twice");
  done(); await settle(); assert.equal(f.modal().props.visible, false);
}
{
  const f = fixture(); const api = f.api();
  api.showPopup({ title: "First", message: "", actions: [{ label: "Next", onPress: () => api.showPopup({ title: "Second", message: "A follow-up", actions: [{ label: "OK" }] }) }] });
  f.press("Next")(); await settle();
  assert.equal(f.modal().props.visible, true, "an action must not erase the follow-up popup it just opened");
  assert.match(f.text(), /Second/);
}
for (const failure of [false, true]) {
  const f = fixture(); let resolve!: () => void, reject!: (e: Error) => void;
  const pending = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  f.api().showPopup({ title: "Old", message: "", actions: [{ label: "Wait", onPress: () => pending }] });
  f.press("Wait")();
  f.api().showPopup({ title: "New", message: "", actions: [{ label: "OK" }] });
  if (failure) reject(Error("old request")); else resolve();
  await settle();
  assert.equal(f.modal().props.visible, true, "stale completion cannot close a replacement popup");
  assert.match(f.text(), /New/); assert.doesNotMatch(f.text(), /could not be completed/);
}
{
  const f = fixture(); let attempts = 0;
  f.api().showPopup({ title: "Retry", message: "", actions: [{ label: "Try", onPress: () => { if (++attempts === 1) throw Error("offline"); } }] });
  f.press("Try")(); await settle(); assert.equal(f.modal().props.visible, true); assert.match(f.text(), /could not be completed/);
  f.press("Try")(); await settle(); assert.equal(attempts, 2); assert.equal(f.modal().props.visible, false);
}
console.log("Popup action locking, chained popups, stale requests and retry tests passed");
