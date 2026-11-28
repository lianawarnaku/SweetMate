import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const compiled = ts.transpileModule(
  readFileSync("components/PasswordRecoveryScreen.tsx", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: false,
    },
  },
).outputText;
async function settle() {
  for (let i = 0; i < 35; i++) await Promise.resolve();
}
function fixture() {
  const values: any[] = [],
    effects: any[] = [],
    calls: any[] = [];
  let cursor = 0,
    mounted = false;
  let fail: any = null,
    release: (() => void) | null = null,
    gated = false;
  const jsx = (type: any, props: any) => ({ type, props });
  class FlowError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  const services = {
    request: async (...args: any[]) => {
      calls.push(["email", ...args]);
      if (gated)
        await new Promise<void>((done) => {
          release = done;
        });
      if (fail) throw fail;
    },
    change: async (...args: any[]) => {
      calls.push(["change", ...args]);
      if (gated)
        await new Promise<void>((done) => {
          release = done;
        });
      if (fail) throw fail;
    },
    reauthenticate: async () => {
      calls.push(["reauthenticate"]);
    },
  };
  const module: any = {};
  const React = {
    useState: (initial: any) => {
      const i = cursor++;
      if (!(i in values)) values[i] = initial;
      return [
        values[i],
        (next: any) => {
          values[i] = typeof next === "function" ? next(values[i]) : next;
        },
      ];
    },
    useRef: (initial: any) => {
      const i = cursor++;
      if (!(i in values)) values[i] = { current: initial };
      return values[i];
    },
    useEffect: (effect: any) => {
      if (!mounted) effects.push(effect);
    },
    useSyncExternalStore: (_s: any, get: any) => get(),
  };
  runInNewContext(compiled, {
    exports: module,
    URL,
    URLSearchParams,
    Date,
    Error,
    console,
    setInterval: () => 0,
    clearInterval: () => {},
    require: (name: string) => {
      if (name === "react") return React;
      if (name === "react/jsx-runtime")
        return { jsx, jsxs: jsx, Fragment: "Fragment" };
      if (name === "react-native")
        return {
          ActivityIndicator: "Spinner",
          AppState: { addEventListener: () => ({ remove() {} }) },
          Linking: {
            addEventListener: () => ({ remove() {} }),
            getInitialURL: async () => null,
          },
          Platform: { OS: "ios" },
          KeyboardAvoidingView: "Keyboard",
          ScrollView: "ScrollView",
          StyleSheet: { create: (v: any) => v },
          Text: "Text",
          TextInput: "TextInput",
          View: "View",
        };
      if (name === "expo-linking")
        return { createURL: () => "sweetmate://auth/reset-password" };
      if (name === "expo-haptics")
        return {
          NotificationFeedbackType: { Success: "success" },
          notificationAsync: async () => {},
        };
      if (name === "react-native-safe-area-context")
        return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
      if (name === "@/constants/colors")
        return {
          useTheme: () => ({
            foreground: "#fff",
            mutedForeground: "#bbb",
            card: "#111",
            background: "#000",
            border: "#333",
            primary: "#bbb",
            actionForeground: "#fff",
            destructive: "#f66",
          }),
        };
      if (name === "@/lib/supabase")
        return {
          supabase: {
            auth: {
              getSession: async () => ({
                data: { session: { user: { id: "user" } } },
              }),
            },
          },
        };
      if (name === "@/lib/passwordRecovery")
        return {
          PasswordFlowError: FlowError,
          PasswordRecoveryController: class {},
          passwordServices: services,
          passwordFlowError: (e: any) => e,
          passwordValidation: (p: string, c: string) =>
            p.length < 12
              ? "Use at least 12 characters."
              : p !== c
                ? "The passwords do not match."
                : null,
          recoveryLink: () => null,
        };
      if (name === "@/lib/pushRegistration")
        return { signOutWithPushCleanup: async () => ({ error: null }) };
      if (name === "@/lib/keyboard") return { KEYBOARD_BEHAVIOR: "padding" };
      if (name === "@/components/BrandMark") return { BrandMark: "Brand" };
      if (name === "@/components/GlassButton")
        return { GlassButton: "GlassButton" };
      if (name === "@/components/HouseTransition")
        return { HouseTransition: "Transition" };
      throw Error(name);
    },
  });
  const render = (component: string, props: any) => {
    cursor = 0;
    const tree = module[component](props);
    if (!mounted) {
      mounted = true;
      effects.forEach((effect) => effect());
    }
    return tree;
  };
  return {
    render,
    services,
    calls,
    module,
    fail: (e: any) => {
      fail = e;
    },
    gate: () => {
      gated = true;
    },
    release: () => {
      gated = false;
      release?.();
    },
    FlowError,
  };
}
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const input = (tree: any, label: string) =>
  nodes(tree).find(
    (n) => n.type === "TextInput" && n.props.accessibilityLabel === label,
  );
const button = (tree: any, label: string) =>
  nodes(tree).find((n) => n.props?.label === label);
const feedback = (tree: any) =>
  nodes(tree)
    .map((n) => n.props?.message)
    .filter(Boolean)
    .join(" ");
{
  const f = fixture();
  let back = 0;
  const props = { initialEmail: "", onClose: () => back++ };
  let tree = f.render("RecoveryEmailForm", props);
  assert(button(tree, "Send reset email").props.disabled);
  input(tree, "Recovery email").props.onChangeText("dummy@example.test");
  tree = f.render("RecoveryEmailForm", props);
  f.gate();
  button(tree, "Send reset email").props.onPress();
  button(tree, "Send reset email").props.onPress();
  await settle();
  assert.equal(
    f.calls.length,
    1,
    "a synchronous guard blocks duplicate requests before rerender",
  );
  tree = f.render("RecoveryEmailForm", props);
  assert(button(tree, "Back").props.disabled);
  f.release();
  await settle();
  tree = f.render("RecoveryEmailForm", props);
  assert.match(feedback(tree), /If an account/);
  assert.equal(f.calls[0][2], "sweetmate://auth/reset-password");
  button(tree, "Back").props.onPress();
  assert.equal(back, 1);
}
{
  const f = fixture();
  f.fail(
    new f.FlowError("unavailable", "Check your connection and try again."),
  );
  const props = { onClose() {} };
  let tree = f.render("RecoveryEmailForm", props);
  input(tree, "Recovery email").props.onChangeText("dummy@example.test");
  tree = f.render("RecoveryEmailForm", props);
  button(tree, "Send reset email").props.onPress();
  await settle();
  tree = f.render("RecoveryEmailForm", props);
  assert.match(feedback(tree), /connection/);
  assert.equal(input(tree, "Recovery email").props.value, "dummy@example.test");
  assert(!button(tree, "Send reset email").props.disabled);
}
{
  const f = fixture();
  let cancelled = 0;
  const props = {
    currentRequired: true,
    onSave: f.services.change,
    onCancel: () => cancelled++,
    onReauthenticate: f.services.reauthenticate,
    onRecover() {},
  };
  let tree = f.render("PasswordForm", props);
  assert(input(tree, "Current password").props.secureTextEntry);
  assert(input(tree, "New password").props.secureTextEntry);
  input(tree, "Current password").props.onChangeText("synthetic-old");
  input(tree, "New password").props.onChangeText("short");
  input(tree, "Confirm new password").props.onChangeText("short");
  tree = f.render("PasswordForm", props);
  button(tree, "Save new password").props.onPress();
  await settle();
  tree = f.render("PasswordForm", props);
  assert.match(feedback(tree), /12/);
  assert.equal(f.calls.length, 0);
  input(tree, "New password").props.onChangeText("synthetic-new-password");
  input(tree, "Confirm new password").props.onChangeText(
    "synthetic-new-password",
  );
  tree = f.render("PasswordForm", props);
  f.gate();
  button(tree, "Save new password").props.onPress();
  button(tree, "Save new password").props.onPress();
  await settle();
  tree = f.render("PasswordForm", props);
  assert.equal(f.calls.length, 1);
  assert(button(tree, "Cancel").props.disabled);
  assert(button(tree, "Use email recovery instead").props.disabled);
  assert(!input(tree, "New password").props.editable);
  f.release();
  await settle();
  tree = f.render("PasswordForm", props);
  button(tree, "Cancel").props.onPress();
  assert.equal(cancelled, 1);
}
{
  const f = fixture();
  f.fail(new f.FlowError("reauthentication", "Enter the security code."));
  const props = {
    currentRequired: false,
    onSave: f.services.change,
    onCancel() {},
    onReauthenticate: f.services.reauthenticate,
  };
  let tree = f.render("PasswordForm", props);
  assert(!input(tree, "Current password"));
  input(tree, "New password").props.onChangeText("synthetic-new-password");
  input(tree, "Confirm new password").props.onChangeText(
    "synthetic-new-password",
  );
  tree = f.render("PasswordForm", props);
  button(tree, "Save new password").props.onPress();
  await settle();
  tree = f.render("PasswordForm", props);
  assert(input(tree, "Email security code"));
  assert(f.calls.some((c) => c[0] === "reauthenticate"));
  assert.match(feedback(tree), /security code/);
}
console.log(
  "Actual recovery forms passed: generic email confirmation, failed-send retry, protected password inputs, validation, duplicate-submit locks, busy controls and reauthentication code entry.",
);
