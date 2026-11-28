import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const source = ts.createSourceFile(
  "AppContext.tsx",
  readFileSync("context/AppContext.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let effect: ts.Node | undefined, join: ts.Node | undefined;
function visit(node: ts.Node) {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(source) === "useEffect" &&
    node.arguments[0]?.getText(source).includes("const storedActiveSweetId")
  )
    effect = node.arguments[0];
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(source) === "joinHousehold" &&
    node.initializer &&
    ts.isCallExpression(node.initializer)
  )
    join = node.initializer.arguments[0];
  ts.forEachChild(node, visit);
}
visit(source);
assert(effect);
assert(join);
const compile = (node: ts.Node) =>
  ts.transpileModule(`exports.run=${node.getText(source)}`, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
function startsLoad(prior: string | undefined, householdId: string | null) {
  const calls: boolean[] = [],
    exports: any = {};
  runInNewContext(compile(effect!), {
    exports,
    session: { user: { id: "actor" } },
    householdId,
    membershipAccountRef: { current: prior },
    membershipLoadGenerationRef: { current: 0 },
    setHouseholdLoading: (value: boolean) => calls.push(value),
    setHouseholdError: () => {},
    fetchAllRows: () => new Promise(() => {}),
  });
  const cleanup = exports.run();
  cleanup();
  return calls;
}
assert.deepEqual(
  startsLoad("actor", "home"),
  [],
  "background invitation refresh must keep the open settings form mounted",
);
assert.deepEqual(
  startsLoad("other", "home"),
  [true],
  "a different account still needs the loading boundary",
);
assert.deepEqual(
  startsLoad("actor", null),
  [true],
  "initial/retry loading still blocks premature household creation",
);
let response: any = { ok: false, message: "Ask the host" },
  storage = 0,
  joined = 0;
const id = "12345678-1234-1234-1234-123456789abc",
  actor = { current: "actor" },
  exports: any = {};
runInNewContext(compile(join!), {
  exports,
  session: { user: { id: "actor" } },
  activeUserIdRef: actor,
  invitationDigest: async () => "hash",
  joinedHousehold: (value: any) => {
    if (!value?.ok) throw Error(value.message);
    return value.household_id;
  },
  supabase: { rpc: async () => ({ data: response, error: null }) },
  memberships: [],
  AsyncStorage: {
    setItem: async () => storage++,
    mergeItem: async () => storage++,
  },
  activeSweetKey: () => "active",
  userPreferencesKey: () => "prefs",
  setPreferencesOnboardingPending: () => {},
  setCurrentUserIdState: () => {},
  setMembershipVersion: () => {},
  track: { sweetJoined: () => joined++ },
  reportSupabaseError: () => {},
});
await assert.rejects(exports.run("CODE", "Name", "#888888"), /Ask the host/);
assert.equal(storage, 0);
assert.equal(joined, 0);
actor.current = "other";
response = { ok: true, household_id: id };
await assert.rejects(exports.run("CODE", "Name", "#888888"), /account changed/);
assert.equal(storage, 0);
actor.current = "actor";
await exports.run("CODE", "Name", "#888888");
assert.equal(storage, 2);
assert.equal(joined, 1);
console.log(
  "Actual membership loader preserves open personal codes during background refresh; join denial/account change never commits local success",
);
