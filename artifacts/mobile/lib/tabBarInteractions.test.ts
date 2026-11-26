import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as visibility from "./tabVisibility.ts";
import * as gestures from "./tabBarGesture.ts";

type Element = { type: any; props: any };
function fixture() {
  const slots: any[] = [], effects: any[] = [], pending: (() => void)[] = [];
  let cursor = 0, now = 0, timerId = 0, popup: any, presses = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const context = { pointsEnabled: false, hiddenTabs: [] as visibility.AppTabId[], setTabHidden: (id: visibility.AppTabId, hidden: boolean) => {
    const next = visibility.changeHiddenTab(context.hiddenTabs, id, hidden);
    if (!next) return false;
    context.hiddenTabs = next;
    return true;
  } };
  const memo = (fn: () => any, deps: any[]) => {
    const i = cursor++, old = slots[i];
    if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) slots[i] = { deps, value: fn() };
    return slots[i].value;
  };
  const react = {
    useRef: (value: any) => { const i = cursor++; return slots[i] ??= { current: value }; },
    useState: (value: any) => { const i = cursor++; slots[i] ??= { value }; return [slots[i].value, (next: any) => { slots[i].value = next; }]; },
    useMemo: memo, useCallback: (fn: any, deps: any[]) => memo(() => fn, deps),
    useEffect: (effect: () => any, deps: any[]) => {
      const i = cursor++, old = effects[i];
      if (old && deps.every((value, j) => Object.is(value, old.deps[j]))) return;
      pending.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: effect() }; });
    },
  };
  class Value {
    value: number; listeners = new Set<(value: any) => void>();
    constructor(value: number) { this.value = value; }
    setValue(value: number) { this.value = value; this.listeners.forEach(fn => fn({ value })); }
    interpolate() { return this; }
    stopAnimation(callback?: (value: number) => void) { callback?.(this.value); }
    addListener(fn: (value: any) => void) { this.listeners.add(fn); return fn; }
    removeListener(fn: (value: any) => void) { this.listeners.delete(fn); }
  }
  const animate = (value: Value, config: any) => ({ start: (callback?: any) => { value.setValue(config.toValue); callback?.({ finished: true }); } });
  const jsx = (type: any, props: any) => ({ type, props });
  const routes = visibility.APP_TABS.map(tab => ({ name: tab.id, key: tab.id, params: undefined }));
  const state = { routes, index: 0 };
  const descriptors = Object.fromEntries(visibility.APP_TABS.map(tab => [tab.id, { options: { title: tab.label } }]));
  const navigation = {
    emit: (event: any) => { if (event.type === "tabPress") presses++; return { defaultPrevented: false }; },
    navigate: (name: string) => { state.index = routes.findIndex(route => route.name === name); },
    getState: () => state, preload: () => {},
  };
  const exports: any = {};
  const source = readFileSync("app/(tabs)/_layout.tsx", "utf8") + "\nexport { ScrollableTabBar };";
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, require: (name: string) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
    if (name === "react-native") return {
      Animated: { Value, View: "Animated.View", spring: animate, timing: animate },
      PanResponder: { create: (handlers: any) => ({ panHandlers: handlers }) },
      InteractionManager: { runAfterInteractions: () => ({ cancel() {} }) },
      Platform: { OS: "ios" }, StyleSheet: { create: (styles: any) => styles }, Text: "Text", View: "View",
    };
    if (name === "@/context/AppContext") return { useAppContextSelector: (selector: any) => selector(context) };
    if (name === "@/components/AppPopupProvider") return { useAppPopup: () => ({ showPopup: (request: any) => { popup = request; } }) };
    if (name === "@/lib/tabVisibility") return visibility;
    if (name === "@/lib/tabBarGesture") return gestures;
    if (name === "@/constants/featureAvailability") return { isLeaderboardVisible: () => false };
    if (name === "@/constants/colors") return { useTheme: () => ({}) };
    if (name === "@/hooks/useAccessibilityPreferences") return { useAccessibilityPreferences: () => ({ reduceMotion: true, reduceTransparency: true }) };
    if (name === "@/hooks/useTabBarLayout") return { useTabBarLayout: () => ({ tabBarBottom: 12 }) };
    if (name === "@/components/LiquidGlass") return { GlassTabBar: "GlassTabBar" };
    if (name === "@/components/SmoothPressable") return { SmoothPressable: "SmoothPressable" };
    if (name === "@/lib/haptics") return { tapLight() {} };
    if (name === "@expo/vector-icons") return { Feather: "Feather" };
    if (name === "expo-router/js-tabs") return { Tabs: "Tabs" };
    throw Error(name);
  }, setTimeout: (callback: () => void, delay: number) => { const id = ++timerId; timers.set(id, { at: now + delay, callback }); return id; }, clearTimeout: (id: number) => timers.delete(id) });
  function elements(node: any): Element[] {
    if (Array.isArray(node)) return node.flatMap(elements);
    return node && typeof node === "object" && node.props ? [node, ...elements(node.props.children)] : [];
  }
  const render = () => {
    cursor = 0;
    const tree = exports.ScrollableTabBar({ state, descriptors, navigation });
    pending.splice(0).forEach(fn => fn());
    const nodes = elements(tree);
    return {
      tab: (label: string) => nodes.find(node => node.props.accessibilityRole === "tab" && node.props.accessibilityLabel === label)!.props,
      tabs: nodes.filter(node => node.props.accessibilityRole === "tab").map(node => node.props.accessibilityLabel),
      overlay: nodes.find(node => node.props.testID === "selected-tab-gesture")?.props,
      layout: () => nodes.find(node => node.props.onLayout)!.props.onLayout({ nativeEvent: { layout: { width: 500 } } }),
    };
  };
  const advance = (amount: number) => {
    const end = now + amount;
    while (true) {
      const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at; timers.delete(due[0]); due[1].callback();
    }
    now = end;
  };
  render().layout();
  return { render, advance, context, state, popup: () => popup, presses: () => presses,
    unmount: () => effects.forEach(effect => effect?.cleanup?.()), navigate: navigation.navigate,
  };
}
{
  const f = fixture(); const tab = f.render().tab("Shopping");
  assert.equal(f.render().tabs.length, 5);
  tab.onPressIn(); tab.onLongPress();
  assert.equal(f.popup().title, "Hide Shopping?");
  assert.equal(f.state.index, 0, "long-pressing an inactive tab does not navigate");
  tab.onPress(); assert.equal(f.state.index, 0, "releasing a held icon cannot activate it");
  assert.deepEqual(f.context.hiddenTabs, [], "opening or cancelling the menu does not hide anything");
  f.popup().actions[0].onPress();
  assert.deepEqual(f.render().tabs, ["My Sweet", "Group", "Expenses", "Borrow"]);
}
{
  const f = fixture(); const overlay = f.render().overlay;
  overlay.onPanResponderGrant(); f.advance(599); assert.equal(f.popup(), undefined);
  f.advance(1); assert.equal(f.popup().title, "Hide My Sweet?", "the selected icon's overlay also supports a stationary hold");
  overlay.onPanResponderRelease(); assert.equal(f.presses(), 0, "opening a menu must not activate a tab");
  f.popup().actions[0].onPress();
  assert.equal(f.state.routes[f.state.index].name, "group", "hiding the active tab navigates to the next visible tab");
  assert(!f.render().tabs.includes("My Sweet"));
}
{
  const f = fixture(); const overlay = f.render().overlay;
  overlay.onPanResponderGrant(); f.advance(300);
  overlay.onPanResponderMove(null, { dx: 200, dy: 0 }); f.advance(500);
  assert.equal(f.popup(), undefined, "sliding after the drag hold must not open Hide tab");
  overlay.onPanResponderRelease(); assert.equal(f.state.routes[f.state.index].name, "expenses");
}
{
  const f = fixture(); const overlay = f.render().overlay;
  overlay.onPanResponderGrant(); f.advance(100);
  overlay.onPanResponderMove(null, { dx: 40, dy: 0 }); f.advance(700);
  assert.equal(f.popup(), undefined, "movement before the drag hold also cancels the menu timer");
  overlay.onPanResponderTerminate(); f.advance(1000); assert.equal(f.popup(), undefined);
}
{
  const f = fixture(); f.context.hiddenTabs = ["index", "group", "expenses", "shopping"]; f.navigate("borrow");
  const overlay = f.render().overlay; overlay.onPanResponderGrant(); f.advance(600);
  assert.equal(f.popup().title, "Keep one tab visible");
  assert(!f.popup().actions.some((action: any) => action.label === "Hide tab"));
  assert.deepEqual(f.render().tabs, ["Borrow"]);
}
{
  const f = fixture(); f.context.hiddenTabs = ["shopping"]; f.navigate("shopping");
  assert.equal(f.render().overlay, undefined, "opening a hidden route through a direct link must not highlight the wrong visible tab");
  f.context.setTabHidden("shopping", false);
  assert.deepEqual(f.render().tabs, ["My Sweet", "Group", "Expenses", "Shopping", "Borrow"], "restoration returns the tab to its original position");
}
{
  const f = fixture(); f.render().overlay.onPanResponderGrant(); f.unmount(); f.advance(1000);
  assert.equal(f.popup(), undefined, "unmount cancels pending long-press menus");
}
console.log("Tab menus, active/inactive holds, release suppression, drag switching, restoration and last-tab protection passed");

// Run the real context mutation with account/loaded refs, including rapid
// successive hides before React has committed another render.
{
  const source = readFileSync("context/AppContext.tsx", "utf8");
  const start = source.indexOf("  const setTabHidden = useCallback(");
  const end = source.indexOf("\n  // Reset before paint", start);
  assert(start > 0 && end > start);
  const code = ts.transpileModule(`exports.make = function(preferenceUserId, localPreferencesLoaded, pointsEnabled, preferenceOwnerRef, hiddenTabsRef, setHiddenTabs) {
    ${source.slice(start, end)}
    return setTabHidden;
  }`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: any = {};
  runInNewContext(code, { exports, useCallback: (callback: any) => callback, changeHiddenTab: visibility.changeHiddenTab });
  const owner = { current: "avery" }, hidden = { current: [] as visibility.AppTabId[] };
  let commits = 0;
  const avery = exports.make("avery", true, false, owner, hidden, () => { commits++; });
  for (const id of ["index", "group", "expenses", "shopping"]) assert.equal(avery(id, true), true);
  assert.equal(avery("borrow", true), false, "rapid hides must read the latest ref and keep one tab visible");
  assert.equal(commits, 4);
  owner.current = "blake"; hidden.current = [];
  assert.equal(avery("shopping", true), false, "an old popup must not mutate a newly signed-in user's layout");
  assert.deepEqual(hidden.current, []);
  const loadingBlake = exports.make("blake", false, false, owner, hidden, () => { commits++; });
  assert.equal(loadingBlake("shopping", true), false, "preferences cannot be overwritten before hydration finishes");
  const blake = exports.make("blake", true, false, owner, hidden, () => { commits++; });
  assert.equal(blake("borrow", true), true);
  assert.deepEqual(hidden.current, ["borrow"]);
}
console.log("Per-account tab mutation, hydration guard and rapid last-tab protection passed");
