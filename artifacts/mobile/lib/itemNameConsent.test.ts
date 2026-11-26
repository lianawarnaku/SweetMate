import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Run the actual Settings panel with state/storage/network boundaries substituted.
const code = ts.transpileModule(readFileSync("components/AnalyticsConsentManager.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: false, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const prefs: any = { productAnalyticsEnabled: false, crashReportingEnabled: false, noticeVersion: "base", itemNamesEnabled: false, itemNamesNoticeVersion: null };
const saved: any[] = [], popups: any[] = [];
let available = true;
const jsx = (type: any, props: any) => ({ type, props });
const exports: any = {};
const boundary = { analyticsSnapshot: () => ({ loaded: true, preferences: prefs }), subscribeAnalytics: () => () => {},
  PRIVACY_NOTICE_VERSION: "base", ITEM_NAME_NOTICE_VERSION: "names", get ITEM_NAME_ANALYTICS_AVAILABLE() { return available; },
  saveAnalyticsPreferences: async (_user: string, update: any) => { saved.push(update); Object.assign(prefs, update); if (!prefs.productAnalyticsEnabled) { prefs.itemNamesEnabled = false; prefs.itemNamesNoticeVersion = null; } },
};
runInNewContext(code, { exports, require: (name: string) => {
  if (name === "react") return { useSyncExternalStore: (_subscribe: any, get: any) => get() };
  if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
  if (name === "react-native") return { View: "View", Text: "Text", TouchableOpacity: "Link", Linking: { openURL: async () => {} }, StyleSheet: { create: (value: any) => value } };
  if (name === "@/components/AppSwitch") return { AppSwitch: "Switch" };
  if (name === "@/constants/colors") return { useTheme: () => ({}) };
  if (name === "@/components/AppPopupProvider") return { useAppPopup: () => ({ showPopup: (value: any) => popups.push(value) }) };
  if (name === "@/lib/analytics") return boundary;
  throw Error(name);
} });
const nodes = (node: any): any[] => node && typeof node === "object" && node.props ? [node, ...[node.props.children].flat(Infinity).flatMap(nodes)] : [];
const switches = () => nodes(exports.AnalyticsPreferencesPanel({ userId: "test-user" })).filter(node => node.type === "Switch");
const names = () => switches().find(node => node.props.accessibilityLabel.startsWith("Share chore and item names"));
assert.equal(names().props.value, false);
assert.equal(names().props.disabled, true, "name sharing requires current product consent");
switches().find(node => node.props.accessibilityLabel.startsWith("Product analytics")).props.onValueChange(true);
await Promise.resolve();
assert.equal(names().props.disabled, false);
assert.equal(names().props.value, false, "product opt-in must not opt into names");
names().props.onValueChange(true); await Promise.resolve();
assert.equal(saved.at(-1).itemNamesNoticeVersion, "names");
assert.equal(names().props.value, true);
names().props.onValueChange(false); await Promise.resolve();
assert.equal(names().props.value, false);
prefs.itemNamesEnabled = true; prefs.itemNamesNoticeVersion = "old";
assert.equal(names().props.value, false, "an old name notice must display off rather than falsely implying active collection");
prefs.noticeVersion = "old-base";
switches().find(node => node.props.accessibilityLabel.startsWith("Crash reporting")).props.onValueChange(true); await Promise.resolve();
assert.equal(prefs.productAnalyticsEnabled, false, "renewing crash consent must not revive old product consent");
assert.equal(prefs.itemNamesEnabled, false);
available = false;
assert.equal(switches().length, 2, "unpublished-policy release gate hides the new choice");
assert.equal(popups.length, 0);
console.log("Separate Settings name consent, product dependency, stale notices and release gating passed");
