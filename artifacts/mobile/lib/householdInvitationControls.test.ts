import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import ts from "typescript";
const slots: any[] = [],
  effects: any[] = [],
  pending: (() => void)[] = [];
let cursor = 0,
  popup: any,
  copied = "",
  changes = 0;
const calls: any[] = [];
let server: any = {
  enabled: true,
  removed: [{ id: "removed", name: "Removed QA" }],
  invitations: [],
};
const rpc = async (name: string, args: any) => {
  calls.push({ name, args });
  if (name === "get_household_invitations")
    return { data: JSON.parse(JSON.stringify(server)), error: null };
  if (name === "create_household_reinvitation") {
    server.invitations = [
      {
        id: "grant",
        user_id: "removed",
        expires_at: "2026-12-04T12:00:00Z",
        suffix: args.token_suffix,
        approval_only: !args.token_hash,
      },
    ];
    return {
      data: { ok: true, id: "grant", expires_at: "2026-12-04T12:00:00Z" },
      error: null,
    };
  }
  if (name === "manage_household_invites") {
    server.enabled = args.invite_action !== "pause";
    server.invitations = [];
    return { data: { ok: true }, error: null };
  }
  if (name === "revoke_household_reinvitation") {
    server.invitations = [];
    return { data: { ok: true }, error: null };
  }
  throw Error(name);
};
const react = {
  useState: (initial: any) => {
    const i = cursor++;
    slots[i] ??= { value: initial };
    return [
      slots[i].value,
      (value: any) => {
        slots[i].value =
          typeof value === "function" ? value(slots[i].value) : value;
      },
    ];
  },
  useRef: (initial: any) => {
    const i = cursor++;
    return (slots[i] ??= { current: initial });
  },
  useCallback: (fn: any) => fn,
  useEffect: (fn: any, deps: any[]) => {
    const i = cursor++,
      prior = effects[i];
    if (!prior || deps.some((v, n) => !Object.is(v, prior.deps[n])))
      pending.push(() => {
        prior?.cleanup?.();
        effects[i] = { deps, cleanup: fn() };
      });
  },
};
const exports: any = {};
const mods: any = {
  react,
  "react/jsx-runtime": {
    jsx: (type: any, props: any) => ({ type, props }),
    jsxs: (type: any, props: any) => ({ type, props }),
  },
  "react-native": {
    View: "View",
    Text: "Text",
    ActivityIndicator: "Spinner",
    StyleSheet: { create: (v: any) => v },
  },
  "@expo/vector-icons": { Feather: "Icon" },
  "expo-crypto": { randomUUID: () => "12345678-1234-1234-1234-123456789abc" },
  "expo-clipboard": {
    setStringAsync: async (code: string) => {
      copied = code;
    },
  },
  "@/components/GlassButton": { GlassButton: "Button" },
  "@/components/AppPopupProvider": {
    useAppPopup: () => ({
      showPopup: (value: any) => {
        popup = value;
      },
    }),
  },
  "@/constants/colors": {
    useTheme: () => ({
      card: "#181818",
      border: "#444",
      foreground: "#fff",
      mutedForeground: "#bbb",
      destructive: "#e88",
      destructiveForeground: "#111114",
      primary: "#fff",
    }),
  },
  "@/lib/supabase": {
    supabase: {
      rpc,
      channel: () => ({
        on() {
          return this;
        },
        subscribe() {
          return this;
        },
      }),
      removeChannel: () => {},
    },
    pendingOperations: { subscribeRecovery: () => () => {} },
  },
  "@/lib/householdInvitations": {
    invitationDigest: async (code: string) =>
      createHash("sha256").update(code).digest("hex"),
  },
};
runInNewContext(
  ts.transpileModule(
    readFileSync("components/HouseholdInvitationControls.tsx", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText,
  {
    exports,
    Map,
    Date,
    Error,
    Promise,
    require: (name: string) => {
      assert(name in mods, name);
      return mods[name];
    },
  },
);
const render = (householdId = "home") => {
  cursor = 0;
  const tree = exports.HouseholdInvitationControls({
    householdId,
    userId: "host",
    onChanged: () => changes++,
  });
  pending.splice(0).forEach((fn) => fn());
  return tree;
};
function nodes(tree: any): any[] {
  return !tree
    ? []
    : Array.isArray(tree)
      ? tree.flatMap(nodes)
      : typeof tree === "object"
        ? [tree, ...nodes(tree.props?.children)]
        : [];
}
const button = (tree: any, label: string) => {
  const match = nodes(tree).find(
    (node) => node.type === "Button" && node.props.accessibilityLabel === label,
  );
  assert(match, label);
  return match.props;
};
const settle = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
let tree = render();
assert.equal(nodes(tree).filter((node) => node.type === "Button").length, 1);
button(tree, "Invitation controls").onPress();
render();
await settle();
tree = render();
assert.equal(
  button(tree, "Pause invitations").children.props.style.at(-1).color,
  "#111114",
  "destructive text must contrast with its fill",
);
button(tree, "Replace code").onPress();
assert(popup);
assert.equal(
  calls.filter((call) => call.name === "manage_household_invites").length,
  0,
);
assert(popup.actions.some((action: any) => action.label === "Cancel"));
button(tree, "Approve Removed QA to rejoin").onPress();
await settle();
tree = render();
assert.equal(
  calls.find((call) => call.name === "create_household_reinvitation").args
    .token_hash,
  null,
);
button(tree, "Create invitation for Removed QA").onPress();
await settle();
tree = render();
const sent = calls
  .filter((call) => call.name === "create_household_reinvitation")
  .at(-1).args;
assert.match(sent.token_hash, /^[a-f0-9]{64}$/);
assert.equal(sent.token_suffix, "9ABC");
assert(!JSON.stringify(sent).includes("12345678123412341234123456789ABC"));
button(tree, "Copy personal code").onPress();
await settle();
assert.equal(copied, "12345678123412341234123456789ABC");
button(tree, "Revoke Removed QA's invitation").onPress();
await settle();
tree = render();
assert.equal(server.invitations.length, 0);
button(tree, "Pause invitations").onPress();
popup.actions.find((action: any) => action.destructive).onPress();
await settle();
tree = render();
assert.equal(server.enabled, false);
assert(button(tree, "Enable invitations"));
button(tree, "Enable invitations").onPress();
await settle();
tree = render();
assert.equal(server.enabled, true);
assert(changes >= 4);
const switched = render("other-home");
assert.equal(
  nodes(switched).filter((node) => node.type === "Button").length,
  1,
  "household switch closes prior controls and hides personal codes",
);
console.log(
  "Actual host controls pass approval, hash-only personal codes, copy, revoke, pause confirmation, resume, scoped state and accessible actions",
);
