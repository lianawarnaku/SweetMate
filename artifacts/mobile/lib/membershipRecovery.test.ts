import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = ts.createSourceFile("AppContext.tsx", readFileSync("context/AppContext.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback: ts.Node | undefined;
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect"
    && node.arguments[0]?.getText(source).includes("my-sweet-memberships:")) callback = node.arguments[0];
  ts.forEachChild(node, visit);
}
visit(source); assert(callback);
const code = ts.transpileModule(`exports.effect = ${callback.getText(source)};`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let event!: () => void, status!: (s: string) => void, foreground!: (s: string) => void;
let version = 0, removed = 0, unsubscribed = 0;
const channel = { on: (_type: string, filter: any, fn: any) => {
  assert.equal(filter.table, "household_members"); assert.equal(filter.filter, "user_id=eq.member-a"); event = fn; return channel;
}, subscribe: (fn: any) => { status = fn; return channel; } };
const exports: any = {};
runInNewContext(code, { exports, session: { user: { id: "member-a" } },
  pendingOperations: { retry: () => Promise.resolve() }, setMembershipVersion: (fn: any) => { version = fn(version); },
  AppState: { addEventListener: (_name: string, fn: any) => { foreground = fn; return { remove: () => removed++ }; } },
  supabase: { channel: () => channel, removeChannel: () => { unsubscribed++; } } });
const cleanup = exports.effect();
status("SUBSCRIBED"); await Promise.resolve(); await Promise.resolve(); assert.equal(version, 1, "initial/reconnected membership must be reread");
event(); await Promise.resolve(); await Promise.resolve(); assert.equal(version, 2, "own revocation must reload active memberships");
status("CHANNEL_ERROR"); await Promise.resolve(); await Promise.resolve(); assert.equal(version, 2);
status("SUBSCRIBED"); await Promise.resolve(); await Promise.resolve(); assert.equal(version, 3, "missed offline revocation must recover");
foreground("background"); await Promise.resolve(); await Promise.resolve(); assert.equal(version, 3);
foreground("active"); await Promise.resolve(); await Promise.resolve(); assert.equal(version, 4, "foreground must recheck access");
cleanup(); event(); status("SUBSCRIBED"); foreground("active");
await Promise.resolve(); await Promise.resolve(); assert.equal(version, 4, "late events from an old signed-in account must be ignored");
assert.equal(removed, 1); assert.equal(unsubscribed, 1);
console.log("Membership recovery passes own events, reconnect, foreground and account cleanup.");
