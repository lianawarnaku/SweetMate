import type { Chore } from "../context/AppContext.ts";
import { activeChores } from "./choreLifecycle.ts";
import { householdDateKey } from "./choreTimezone.ts";
import {
  dateInput,
  parseDueDate,
  todayDateInput,
  tomorrowDateInput,
} from "./choreForm.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(parseDueDate("") === null, "empty dates must be rejected");
assert(parseDueDate("2026-02-30") === null, "impossible dates must be rejected");
assert(parseDueDate("2026/02/28") === null, "non-ISO date input must be rejected");
assert(parseDueDate(" 2028-02-29 ") !== null, "trimmed leap-day input must be accepted");
assert(
  todayDateInput(new Date(2026, 6, 28, 12)) === "2026-07-28",
  "new chores must be able to default to the current local day",
);
assert(
  dateInput(new Date(2026, 6, 28, 23, 59)) === "2026-07-28",
  "date inputs must preserve the local calendar day instead of the UTC day",
);
assert(
  tomorrowDateInput(new Date(2026, 11, 31, 12)) === "2027-01-01",
  "the default date must cross year boundaries",
);
assert(
  tomorrowDateInput(new Date(2028, 1, 28, 12)) === "2028-02-29",
  "the default date must support leap years",
);

// A phone in a different timezone must not push today's chore into tomorrow
// for the household lists. Exercise both directions and daylight-saving dates.
for (const timezone of ["UTC", "America/New_York", "Pacific/Auckland"]) {
  for (const date of ["2026-11-12", "2026-03-08", "2026-11-01"]) {
    const dueDate = parseDueDate(date, timezone)!;
    assert(householdDateKey(new Date(dueDate), timezone) === date, "due date must retain the household calendar day");
    const chore: Chore = { id: "new", title: "Wash dishes", assignedTo: "me", householdId: "sweet", dueDate,
      scheduledDate: date, completed: false, points: 20, category: "cleaning" };
    const now = new Date(new Date(dueDate).getTime() - 3600000);
    assert(activeChores([chore], now, timezone).length === 1, "a newly added chore due today must immediately appear in personal and group active lists");
    const tomorrow = new Date(new Date(dueDate).getTime() - 36 * 3600000);
    assert(activeChores([chore], tomorrow, timezone).length === 0, "future chores must remain scheduled for their chosen day");
  }
}
assert(parseDueDate("2026-02-30", "America/New_York") === null, "household timezone parsing must reject invalid dates");

// Exercise the shared form used by both tabs with React Native/vendor stubs.
import strict from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const formSource = readFileSync(resolve(process.cwd(), "components/ManualChoreForm.tsx"), "utf8");
const state: any[] = [];
let cursor = 0;
const inserted: any[] = [];
const created: any[] = [];
const imports: Record<string, any> = {
  react: {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
    Fragment: "Fragment",
    useState: (initial: any) => {
      const i = cursor++;
      if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial;
      return [state[i], (next: any) => { state[i] = typeof next === "function" ? next(state[i]) : next; }];
    },
    useMemo: (fn: any) => fn(),
    useRef: (value: any) => {
      const i = cursor++;
      return state[i] ??= { current: value };
    },
  },
  "react-native": { ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", TouchableOpacity: "TouchableOpacity", View: "View", StyleSheet: { create: (value: any) => value, hairlineWidth: 1 } },
  "@expo/vector-icons": { Feather: "Feather" },
  "expo-haptics": { notificationAsync: async () => {}, NotificationFeedbackType: { Success: "success" } },
  "@/constants/featureAvailability": { isPointsVisible: () => false },
  "@/constants/colors": { useTheme: () => ({}) },
  "@/context/AppContext": { useAppContextSelector: (select: any) => select({
    currentUserId: "me", householdId: "sweet", householdTimezone: "UTC", pointsEnabled: false,
    roommates: [{ id: "me", name: "Liana" }],
    // An existing chore with the same title must not be selected or linked.
    chores: [{ id: "existing", choreDefinitionId: "shared", title: "Wash dishes", householdId: "sweet" }],
    addChore: (draft: any) => { inserted.push(draft); return "new-chore"; },
  }) },
  "@/lib/choreForm": { parseDueDate },
  "@/lib/choreTimezone": { householdDateKey },
  "@/lib/choreSchedule": { advanceScheduledDate: () => "2099-01-02" },
  "@/lib/choreIdentity": { choreDefinitionId: (chore: any) => chore.choreDefinitionId },
  "@/lib/externalTasks": {},
  "@/lib/runtimeDiagnostics": {},
  "@/components/InlineFeedback": { InlineFeedback: "InlineFeedback" },
};
imports.react.default = imports.react;
const exports: any = {};
const compiled = ts.transpileModule(formSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
runInNewContext(compiled, { exports, require: (name: string) => { strict(name in imports, name); return imports[name]; } });
const renderForm = () => { cursor = 0; return exports.ManualChoreForm({ onCreated: (chore: any) => created.push(chore) }); };
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
let tree = renderForm();
strict.equal(nodes(tree).filter(node => node.type === "TextInput").length, 1, "new chore starts with just the title field");
strict.equal(nodes(tree).some(node => node.props?.children?.includes("Shared chore")), false);
const titleField = nodes(tree).find(node => node.props?.accessibilityLabel === "Chore title");
titleField.props.onChangeText("  Wash dishes  ");
tree = renderForm();
nodes(tree).find(node => node.props?.accessibilityLabel === "Chore title").props.onSubmitEditing();
strict.equal(inserted.length, 1);
strict.equal(inserted[0].title, "Wash dishes");
strict.equal(inserted[0].assignedTo, "me");
strict.equal(inserted[0].householdId, "sweet");
strict.equal(inserted[0].choreDefinitionId, undefined, "typing an existing title must still create a new independent chore");
strict.equal(inserted[0].scheduledDate, householdDateKey(new Date(), "UTC"));
strict.equal(created[0].id, "new-chore", "both tabs receive the created chore so they can reveal it immediately");
nodes(tree).find(node => node.props?.accessibilityLabel === "Chore title").props.onSubmitEditing();
strict.equal(inserted.length, 1, "repeated keyboard submission must not duplicate a chore");
console.log("chore form dates and title-only submission tests passed");
