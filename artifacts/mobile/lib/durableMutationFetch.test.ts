import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as durable from "./durableOperations.ts";
import { SaveFeedbackStore, saveRequest } from "./saveFeedback.ts";
const source = ts.transpileModule(
  readFileSync("lib/durableMutationFetch.ts", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const feedback = new SaveFeedbackStore(),
  exports: any = {};
runInNewContext(source, {
  exports,
  Response,
  Headers,
  URL,
  JSON,
  Map,
  Set,
  Promise,
  Error,
  atob,
  require: (name: string) => {
    if (name === "./durableOperations") return durable;
    if (name === "./saveFeedback")
      return { saveFeedback: feedback, saveRequest };
    throw Error(name);
  },
});
let seq = 0,
  offline = false,
  lostAck = false,
  missing = false;
const disk = new Map<string, string>(),
  receipts = new Map<string, any>(),
  requests: any[] = [],
  direct: string[] = [];
const storage = {
  getItem: async (key: string) => disk.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    disk.set(key, value);
  },
};
const network: any = async (input: string, init: any) => {
  const url = String(input);
  if (!url.endsWith("/rpc/execute_app_operation")) {
    direct.push(url);
    return new Response(JSON.stringify([{ id: "milk" }]), { status: 200 });
  }
  const payload = JSON.parse(init.body);
  requests.push({ ...payload, authorization: init.headers.Authorization });
  if (offline) throw Error("Offline");
  if (missing)
    return new Response(JSON.stringify({ code: "PGRST202" }), { status: 404 });
  if (!receipts.has(payload.operation_id))
    receipts.set(payload.operation_id, {
      status: 200,
      data: { id: "milk", completed: true },
    });
  if (lostAck) {
    lostAck = false;
    throw Error("Success response lost");
  }
  return new Response(JSON.stringify(receipts.get(payload.operation_id)), {
    status: 200,
  });
};
const make = () =>
  exports.createDurableMutationFetch({
    baseUrl: "https://local.invalid",
    anonKey: "public",
    fetcher: network,
    storage,
    makeId: () => `id-${++seq}`,
  });
const session = { userId: "avery", accessToken: "a-token" };
const post = (body: any) => ({
  method: "POST",
  headers: {
    Authorization: "Bearer a-token",
    Prefer: "resolution=merge-duplicates",
  },
  body: JSON.stringify(body),
});
const table = "https://local.invalid/rest/v1/shopping_items?on_conflict=id";
let app = make();
app.setSession(session);
feedback.setScope("avery:home");
offline = true;
assert.equal(
  (
    await app.fetch(
      table,
      post({ id: "milk", household_id: "home", completed: true }),
    )
  ).status,
  503,
);
assert.equal(app.pending.length, 1);
assert.equal(feedback.getSnapshot().issues[0].phase, "failed");
assert(![...disk.values()].join().includes("a-token"));
const original = app.pending[0].id;
app.setSession(null);
app = make();
app.setSession(session);
assert.equal(
  (await app.fetch("https://local.invalid/rest/v1/shopping_items")).status,
  503,
  "cold snapshots cannot erase a pending edit",
);
let recovered = 0;
app.subscribeRecovery(() => recovered++);
offline = false;
await app.retry();
assert.equal(recovered, 1);
assert.equal(requests.at(-1).operation_id, original);
assert.equal(app.pending.length, 0);
assert.equal(feedback.getSnapshot().issues.length, 0);
assert.equal(
  (await app.fetch("https://local.invalid/rest/v1/shopping_items")).status,
  200,
);
// Lost acknowledgement -> new transport/process -> same server receipt.
lostAck = true;
assert.equal(
  (
    await app.fetch(
      table,
      post({ id: "milk", household_id: "home", completed: false }),
    )
  ).status,
  503,
);
const lost = app.pending[0].id,
  receiptCount = receipts.size;
app.setSession(null);
app = make();
app.setSession(session);
await app.initialize();
assert.equal(requests.at(-1).operation_id, lost);
assert.equal(receipts.size, receiptCount);
// Sign-out/user change cannot execute the prior user's journal.
offline = true;
await app.fetch(
  table,
  post({ id: "milk", household_id: "home", completed: true }),
);
app.setSession({ userId: "blake", accessToken: "b-token" });
const before = requests.length;
await app.initialize();
assert.equal(requests.length, before);
assert.equal(
  (
    await app.fetch(
      table,
      post({ id: "milk", household_id: "home", completed: true }),
    )
  ).status,
  401,
);
// Auth/Edge calls, read RPCs and the existing expense queue retain their specialized handling.
await app.fetch("https://local.invalid/auth/v1/user", {
  method: "PUT",
  body: JSON.stringify({ password: "test-only" }),
});
await app.fetch("https://local.invalid/functions/v1/delete-account", {
  method: "POST",
  body: "{}",
});
await app.fetch("https://local.invalid/rest/v1/rpc/mutate_expense", {
  method: "POST",
  body: "{}",
});
assert(![...disk.values()].join().includes("password"));
assert.equal(
  (
    await app.fetch("https://local.invalid/rest/v1/unknown", {
      method: "POST",
      body: "{}",
    })
  ).status,
  400,
);
// An undeployed receipt endpoint fails closed and keeps the save pending.
app.setSession(session);
offline = false;
missing = true;
await app.fetch(
  table,
  post({ id: "milk", household_id: "home", completed: true }),
);
assert(app.pending.some((op: any) => !op.rejected));
console.log(
  "Durable Supabase transport cold recovery, feedback, credential exclusion, account change, specialized bypass and deployment guard tests passed",
);
