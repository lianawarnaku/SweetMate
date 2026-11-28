import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Execute the real provider callback while controlling RPC acknowledgement timing.
const source = ts.createSourceFile("AppContext.tsx", readFileSync("context/AppContext.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback: ts.Node | undefined;
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "approveProposedChart" && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0];
  ts.forEachChild(node, visit);
}
visit(source); assert(callback);
const code = ts.transpileModule(`exports.approve = ${callback.getText(source)};`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture() {
  const activeSetupHouseholdRef = { current: "home-a" };
  const activeUserIdRef = { current: "user-a" };
  const calls: unknown[] = [], refreshes: string[] = [];
  let release!: (value: unknown) => void;
  const gate = new Promise(resolve => { release = resolve; });
  const exports: any = {};
  runInNewContext(code, { exports, Error, session: { user: { id: "user-a" } }, activeUserIdRef, householdId: "home-a", currentProposedChart: { id: "old-chart" }, activeSetupHouseholdRef,
    supabase: { rpc: (...args: unknown[]) => { calls.push(args); return gate; } }, reportSupabaseError: () => {},
    refreshChartStateRef: { current: async () => { refreshes.push(activeSetupHouseholdRef.current); } } });
  return { ...exports, calls, refreshes, release, activeSetupHouseholdRef, activeUserIdRef };
}
let f = fixture(); let done = f.approve(); f.release({ error: null }); await done;
assert.equal(f.calls.length, 1); assert.deepEqual(f.refreshes, ["home-a"]);
f = fixture(); const changed = f.approve().catch((error: Error) => error); f.activeSetupHouseholdRef.current = "home-b"; f.release({ error: null });
assert.match((await changed)?.message ?? "", /household changed/i, "a late approval acknowledgement must not show success in another household");
assert.deepEqual(f.refreshes, [], "an old request must not refresh the new household");
f = fixture(); f.activeSetupHouseholdRef.current = "home-b";
await assert.rejects(f.approve(), /household changed/i); assert.equal(f.calls.length, 0);
f = fixture(); const stale = f.approve().catch((error: Error) => error); f.release({ error: new Error("This chart has changed") });
assert.equal((await stale).message, "This chart has changed"); assert.deepEqual(f.refreshes, ["home-a"], "a rejected stale preview must reload the current chart");
f = fixture(); const failedElsewhere = f.approve().catch((error: Error) => error); f.activeSetupHouseholdRef.current = "home-b"; f.release({ error: new Error("Request failed") });
assert.equal((await failedElsewhere).message, "Request failed"); assert.deepEqual(f.refreshes, []);
f = fixture(); const switchedAccount = f.approve().catch((error: Error) => error); f.activeUserIdRef.current = "user-b"; f.release({ error: null });
assert.match((await switchedAccount)?.message ?? "", /account|household changed/i, "a late acknowledgement must not report success for a different account in the same household");
assert.deepEqual(f.refreshes, []);
console.log("Chart approval persistence tests passed: correct target, stale recovery, and account/household boundaries.");
