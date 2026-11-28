import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as validation from "./borrowValidation.ts";
import { borrowDateInput, borrowDaysUntil } from "./borrowDates.ts";

type Element = { type: string; props: Record<string, any> };
function fixture(initialUser = "avery") {
  const slots: any[] = [], effects: any[] = [], pending: Array<() => void> = []; let cursor = 0, id = 0;
  let failure: string | null = null, release: (() => void) | undefined;
  const saves: any[] = [];
  const routeParams: { add?: string } = {};
  const context: any = { currentUserId: initialUser, householdId: "home", roommates: [], borrowItems: [], isHost: false,
    addBorrowItem: async (entry: any, draftId: string) => {
      saves.push({ entry, draftId }); if (failure === "throw") throw Error("Connection interrupted. Try again.");
      if (failure === "pending") await new Promise<void>(resolve => { release = resolve; });
      if (failure === "reject") return null;
      return "new-borrow";
    }, updateBorrowItem: async () => true,
  };
  const useState = (initial: any) => { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (next: any) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; };
  const react = { useState, useRef: (value: any) => useState({ current: value })[0], useMemo: (fn: any) => fn(), useCallback: (fn: any) => fn,
    useEffect: (effect: any, deps: any[]) => { const index = cursor++, prior = effects[index];
      if (prior && deps.every((value, j) => Object.is(value, prior.deps[j]))) return;
      pending.push(() => { prior?.cleanup?.(); effects[index] = { deps, cleanup: effect() }; });
    } };
  const jsx = (type: string, props: Record<string, any>) => ({ type, props });
  const output: any = {};
  const code = ts.transpileModule(readFileSync("app/(tabs)/borrow.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: false, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, { exports: output, Date, Promise, Error, require: (name: string) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
    if (name === "react-native") return { View: "View", Text: "Text", TextInput: "TextInput", TouchableOpacity: "Button", Pressable: "Button", ScrollView: "ScrollView", Modal: "Modal", FlatList: "FlatList", KeyboardAvoidingView: "Keyboard", ActivityIndicator: "Spinner", Keyboard: { dismiss: () => {} }, Platform: { OS: "ios" }, StyleSheet: { create: (value: any) => value, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 1 } };
    if (name === "@expo/vector-icons") return { Feather: "Icon" };
    if (name === "expo-haptics") return { impactAsync: async () => {}, notificationAsync: async () => {}, ImpactFeedbackStyle: { Light: "light" }, NotificationFeedbackType: { Success: "success" } };
    if (name === "expo-router") return { useLocalSearchParams: () => routeParams, router: { setParams: (next: any) => Object.assign(routeParams, next) } };
    if (name === "expo-crypto") return { randomUUID: () => `draft-${++id}` };
    if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 24, bottom: 20 }) };
    if (name === "@/context/AppContext") return { useAppContextSelector: (select: any) => select(context) };
    if (name === "@/constants/colors") return { useTheme: () => ({ primary: "#fff" }) };
    if (name === "@/lib/borrowValidation") return validation;
    if (name === "@/lib/borrowDates") return { borrowDateInput, borrowDaysUntil };
    if (name === "@/lib/choreOccurrences") return { isBeforeLocalCalendarDay: () => false };
    if (name === "@/lib/resolutionHistory") return { isHistoricalResolution: () => false, historyPage: (value: any) => value };
    if (name === "@/lib/keyboard") return { KEYBOARD_BEHAVIOR: "padding" };
    if (name === "@/lib/haptics") return { success: () => {}, tapLight: () => {} };
    if (name === "@/hooks/useAccessibilityPreferences") return { useAccessibilityPreferences: () => ({ reduceMotion: false }) };
    if (name === "@/components/FloatingActionButton") return { FloatingActionButton: "Button", useFloatingActionMetrics: () => ({ scrollBottomPadding: 80 }) };
    if (name.startsWith("@/components/")) { const key = name.split("/").at(-1)!; return { [key]: key }; }
    throw Error(name);
  } });
  const render = (): Element => { cursor = 0; const tree = output.default(); pending.splice(0).forEach(fn => fn()); return tree; };
  const nodes = (node: any): Element[] => !node || typeof node !== "object" || !node.props ? [] : [node, ...[node.props.children].flat(Infinity).flatMap(nodes)];
  const all = () => nodes(render());
  const find = (label: string) => { const result = all().find(node => node.props.accessibilityLabel === label); assert(result, `missing ${label}`); return result; };
  const button = (label: string) => find(label).props;
  const open = () => button("Add borrowed item").onPress();
  const fillItem = (value: string) => all().find(node => node.props.placeholder === "e.g. Phone charger")!.props.onChangeText(value);
  const owner = (name: string) => {
    const labelled = all().find(node => node.props.accessibilityLabel === `Owner: ${name}`);
    if (labelled) return labelled.props.onPress();
    const result = all().find(node => node.type === "Button" && nodes(node).some(child => child.type === "Text" && child.props.children === name));
    assert(result, `missing owner ${name}`); result.props.onPress();
  };
  return { context, routeParams, render, button, open, fillItem, owner, find, saves, fail: (value: string | null) => { failure = value; }, resolve: () => release?.(),
    modal: () => all().find(node => node.type === "Modal")!, text: () => all().filter(node => node.type === "InlineFeedback").map(node => node.props.message).join(" ") };
}
const members = [{ id: "avery", name: "Avery", color: "#888" }, { id: "blake", name: "Blake", color: "#777" }];
{
  const f = fixture("current"); f.render();
  f.context.currentUserId = "avery"; f.context.roommates = members; f.render(); f.open(); f.fillItem("Self borrowing regression"); f.owner("Avery");
  assert.equal(f.button("Save borrowing transaction").disabled, false, "opening Add after account hydration must use the actual signed-in borrower");
  await f.button("Save borrowing transaction").onPress();
  assert.equal(f.saves[0].entry.borrowedBy, "avery"); assert.equal(f.saves[0].entry.borrowedFrom, "avery");
  assert.equal(f.modal().props.visible, false);
}
{
  const f = fixture(); f.context.roommates = members; f.open(); f.fillItem("Retry self borrowing"); f.owner("Avery"); f.fail("throw");
  await f.button("Save borrowing transaction").onPress();
  assert.equal(f.modal().props.visible, true); assert.equal(f.button("Save borrowing transaction").disabled, false, "a save exception must release the pending lock");
  assert.match(f.text(), /Connection interrupted/); f.fail(null); await f.button("Save borrowing transaction").onPress();
  assert.equal(f.modal().props.visible, false); assert.equal(f.saves[0].draftId, f.saves[1].draftId, "retry must reuse the same draft ID");
}
{
  const f = fixture(); f.context.roommates = members; f.open(); f.fillItem("Pending self borrowing"); f.owner("Avery"); f.fail("pending");
  const save = f.button("Save borrowing transaction").onPress; const pending = save(); save();
  assert.equal(f.saves.length, 1, "rapid taps cannot create duplicate borrowing records");
  assert.equal(f.modal().props.visible, true, "the editor must stay open until saving actually finishes");
  f.resolve(); await pending; assert.equal(f.modal().props.visible, false);
}
{
  const f = fixture(); f.context.roommates = members; f.open(); f.fillItem("Outside owner"); f.owner("Other");
  assert.equal(f.button("Save borrowing transaction").disabled, true, "Other needs an owner name");
  f.find("Other owner name").props.onChangeText("Alex at work");
  assert.equal(f.button("Save borrowing transaction").disabled, false);
  await f.button("Save borrowing transaction").onPress();
  assert.equal(f.saves[0].entry.borrowedFrom, "other"); assert.equal(f.saves[0].entry.externalOwnerName, "Alex at work");
}
console.log("Borrowing editor hydration, self-save, exception retry, duplicate taps, pending persistence and Other owner tests passed");

{
  const f = fixture(); f.context.roommates = members; f.routeParams.add = "from-home";
  f.render(); assert.equal(f.modal().props.visible, true, "quick-add navigation opens borrowing");
  assert.equal(f.routeParams.add, undefined, "consume the quick-add request");
}
