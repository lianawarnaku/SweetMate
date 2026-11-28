import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  applyChoreRowEvent,
  mergeChoreSnapshot,
  planChoreSync,
  sameChoreWrite,
} from "./choreSync.ts";
import { choreToRow, rowToChore } from "./choreRow.ts";
import type { Chore } from "../context/AppContext.ts";
const source = ts.createSourceFile(
  "AppContext.tsx",
  readFileSync("context/AppContext.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let callback: ts.Node | undefined;
function visit(node: ts.Node) {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(source) === "useEffect" &&
    node.arguments[0]
      ?.getText(source)
      .includes("supabase.channel(`chores:${householdId}`)")
  )
    callback = node.arguments[0];
  ts.forEachChild(node, visit);
}
visit(source);
assert(callback);
const code = ts.transpileModule(
  `exports.effect = ${callback.getText(source)};`,
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const chore = (id: string) =>
  ({
    id,
    householdId: "home",
    title: id,
    dueDate: "2026-12-01T12:00:00Z",
    createdAt: "2026-11-01T12:00:00Z",
    updatedAt: "2026-11-01T12:00:00Z",
    creatorId: "actor",
    assignedTo: "actor",
    assignmentMode: "specific-person",
    completed: false,
    points: 1,
    category: "other",
  }) as Chore;
function fixture(cached: Chore[] = []) {
  let remote = [choreToRow(chore("saved"))!],
    hold = true,
    error: unknown = null,
    reads = 0,
    writes = 0;
  const waiting: (() => void)[] = [],
    errors: unknown[] = [];
  let event!: (payload: any) => void, status!: (state: string) => void;
  const choresRef = { current: cached },
    ready = { current: false },
    baseline = { current: new Map() };
  const account = { current: "actor" },
    household = { current: "home" };
  const channel = {
    on: (_kind: string, _filter: unknown, fn: any) => {
      event = fn;
      return channel;
    },
    subscribe: (fn: any) => {
      status = fn;
      return channel;
    },
  };
  const exports: any = {};
  runInNewContext(code, {
    exports,
    Map,
    Set,
    loaded: true,
    cloudReady: true,
    session: { user: { id: "actor" } },
    householdId: "home",
    choresRef,
    choresTableReadyRef: ready,
    persistedChoreRowsRef: baseline,
    uncertainChoreWritesRef: { current: new Set() },
    activeSetupHouseholdRef: household,
    activeUserIdRef: account,
    choreToRow,
    rowToChore,
    applyChoreRowEvent,
    mergeChoreSnapshot,
    planChoreSync,
    sameChoreWrite,
    setChores: (next: Chore[]) => {
      choresRef.current = next;
    },
    setChoresTableReady: (next: boolean) => {
      ready.current = next;
    },
    reportRuntimeError: (...args: unknown[]) => errors.push(args),
    reportSupabaseError: (...args: unknown[]) => errors.push(args),
    fetchAllRows: async () => {
      reads++;
      const snapshot = { data: error ? null : remote.slice(), error };
      if (hold) await new Promise<void>((done) => waiting.push(done));
      return snapshot;
    },
    supabase: {
      channel: () => channel,
      removeChannel: async () => {},
      from: () => ({
        upsert: async () => {
          writes++;
          return { error: null };
        },
      }),
    },
  });
  const close = exports.effect();
  return {
    choresRef,
    ready,
    errors,
    account,
    household,
    close,
    get reads() {
      return reads;
    },
    get writes() {
      return writes;
    },
    release: () => {
      hold = false;
      waiting.splice(0).forEach((fn) => fn());
    },
    insert: (value: Chore) => {
      const row = choreToRow(value)!;
      remote.push(row);
      event({ eventType: "INSERT", new: row });
    },
    reconnect: () => status("SUBSCRIBED"),
    setRemote: (rows: Chore[]) => {
      remote = rows.map((value) => choreToRow(value)!);
    },
    fail: () => {
      error = { code: "offline", message: "offline" };
    },
  };
}
async function tick() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}
{
  const f = fixture();
  assert.equal(f.ready.current, false);
  f.insert(chore("arrived-during-read"));
  f.release();
  await tick();
  assert.equal(f.ready.current, true);
  assert(f.reads >= 2);
  assert.deepEqual(
    f.choresRef.current.map((row) => row.id),
    ["saved", "arrived-during-read"],
    "a Realtime event during paging must invalidate and replace the older candidate snapshot",
  );
  f.setRemote([]);
  f.reconnect();
  await tick();
  assert.equal(f.choresRef.current.length, 0);
  assert.equal(
    f.writes,
    0,
    "an empty reconnect must remove peer-deleted chores, not bootstrap them back",
  );
  f.close();
}
{
  const f = fixture([chore("saved")]);
  f.choresRef.current = [
    { ...chore("saved"), title: "Edit during read" },
    chore("new-local"),
  ];
  f.release();
  await tick();
  assert.equal(
    f.choresRef.current.find((row) => row.id === "saved")?.title,
    "Edit during read",
  );
  assert(f.choresRef.current.some((row) => row.id === "new-local"));
  f.fail();
  f.reconnect();
  await tick();
  assert.equal(
    f.choresRef.current.length,
    2,
    "a failed multi-page refresh preserves the last full snapshot and pending edits",
  );
  f.close();
}
{
  const f = fixture();
  f.account.current = "different-account";
  f.release();
  await tick();
  assert.equal(f.choresRef.current.length, 0);
  assert.equal(f.ready.current, false);
  f.close();
}
console.log(
  "Chore pagination preserves in-flight edits, rejects snapshots superseded by live events, reconciles empty reconnects and ignores old-account reads.",
);
