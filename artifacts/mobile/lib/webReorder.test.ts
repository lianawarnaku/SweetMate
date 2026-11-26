import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type Element = { type: any; props: Record<string, any> };
function fixture(os = "web") {
  const slots: any[] = []; let cursor = 0;
  const begin: number[] = [], end: any[] = [];
  const data = [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }];
  const jsx = (type: any, props: any) => ({ type, props });
  const code = ts.transpileModule(readFileSync("components/DraggableListCompat.tsx", "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, esModuleInterop: false, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports: any = {};
  runInNewContext(code, { exports, require: (name: string) => {
    if (name === "react") return { useState: (initial: any) => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (value: any) => { slots[i] = value; }]; }, useRef: (value: any) => { const i = cursor++; return slots[i] ??= { current: value }; } };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "react-native") return { Platform: { OS: os }, ScrollView: "ScrollView", Text: "Text", View: "View" };
    if (name === "react-native-draggable-flatlist") return { NestableDraggableFlatList: "NativeList", NestableScrollContainer: "NativeScroll", ScaleDecorator: "Decorator" };
    if (name === "react-native-reanimated") return { default: { FlatList: "WebList" } };
    if (name === "@/components/GlassButton") return { GlassButton: "Button" };
    if (name === "@/constants/colors") return { useTheme: () => ({ foreground: "#FFFFFF" }) };
    throw Error(name);
  } });
  const render = (): Element => { cursor = 0; return exports.DraggableListCompat({ data, keyExtractor: (item: any) => item.id, renderItem: (props: any) => jsx("Item", props), onDragBegin: (from: number) => begin.push(from), onDragEnd: (value: any) => end.push(value) }); };
  return { data, render, begin, end, row: (index: number) => render().props.renderItem({ item: data[index], index }) as Element };
}
const all = (node: Element): Element[] => [node, ...[node.props.children].flat(Infinity).filter(child => child && typeof child === "object" && "props" in child).flatMap(all)];
{
  const f = fixture(); all(f.row(0)).find(n => n.type === "Item")!.props.drag();
  const controls = all(f.row(0)).filter(n => n.type === "Button");
  assert(controls.find(n => n.props.accessibilityLabel === "Move Alpha up")!.props.disabled);
  controls.find(n => n.props.accessibilityLabel === "Move Alpha down")!.props.onPress();
  assert.equal(f.end.length, 1); assert.equal(f.end[0].data.map((item: any) => item.id).join(), "b,a");
  assert.equal(f.data.map(item => item.id).join(), "a,b", "reordering never mutates the caller's data array");
}
{
  const f = fixture(); const event = { stopPropagation() {}, preventDefault() {}, dataTransfer: { effectAllowed: "", setData() {} } };
  f.row(0).props.onDragStart(event); f.row(1).props.onDrop(event); f.row(0).props.onDragEnd(event);
  assert.equal(f.begin.join(), "0"); assert.equal(f.end.length, 1, "nested/drop/drag-end events do not duplicate reorders");
  assert.equal(f.end[0].data.map((item: any) => item.id).join(), "b,a");
}
{
  const f = fixture(); const event = { stopPropagation() {}, dataTransfer: { effectAllowed: "", setData() {} } };
  f.row(0).props.onDragStart(event); f.row(0).props.onDragEnd(event);
  assert.equal(f.end[0].from, f.end[0].to, "a canceled drag unlocks scrolling without changing order");
}
assert.equal(fixture("ios").render().type, "NativeList", "native gesture reordering remains unchanged");
console.log("Web drag/drop, accessible move controls, cancellation and native delegation tests passed");
