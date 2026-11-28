import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { SaveFeedbackStore, saveRequest } from "./saveFeedback.ts";
import {
  applyChoreRowEvent,
  planChoreSync,
  sameChoreWrite,
} from "./choreSync.ts";
import { choreToRow, rowToChore } from "./choreRow.ts";
import { choreCompletionTransition } from "./choreCompletion.ts";
import { materializeRecurringOccurrences } from "./choreOccurrences.ts";
import { withoutNormalizedCollections } from "./householdStatePayload.ts";
import type { Chore } from "../context/AppContext.ts";
const source = ts.createSourceFile(
  "AppContext.tsx",
  readFileSync("context/AppContext.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const callbacks: Record<string, string> = {};
const names = [
  "setChoreCompleted",
  "persistSharedSnapshot",
  "persistChoreChanges",
];
function visit(node: ts.Node) {
  if (
    ts.isVariableDeclaration(node) &&
    names.includes(node.name.getText(source)) &&
    node.initializer &&
    ts.isCallExpression(node.initializer)
  )
    callbacks[node.name.getText(source)] =
      node.initializer.arguments[0].getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(Object.keys(callbacks).length, names.length);
const base: Chore = {
  id: "chore",
  householdId: "home",
  creatorId: "actor",
  title: "Counter",
  assignedTo: "actor",
  assignmentMode: "specific-person",
  dueDate: "2026-11-27T23:00:00Z",
  points: 5,
  category: "other",
  completed: false,
  createdAt: "2026-11-01T12:00:00Z",
  updatedAt: "2026-11-01T12:00:00Z",
};
function fixture() {
  const feedback = new SaveFeedbackStore();
  feedback.setScope("actor:home");
  const choresRef = { current: [{ ...base }] },
    roommatesRef = {
      current: [
        { id: "actor", points: 10, weeklyPoints: 10 },
        { id: "peer", points: 0, weeklyPoints: 0 },
      ],
    };
  const server = new Map([[base.id, choreToRow(base)!]]),
    writes: any[] = [];
  let mode = "pass",
    release: (() => void) | undefined,
    completed = 0;
  let savedState: any;
  const bindings: any = {
    exports: {},
    Map,
    Set,
    Date,
    Promise,
    Error,
    session: { user: { id: "actor" } },
    currentUserId: "actor",
    householdId: "home",
    cloudReady: true,
    normalizedCollectionsReady: true,
    activeUserIdRef: { current: "actor" },
    activeSetupHouseholdRef: { current: "home" },
    applyingChartRef: { current: false },
    choresTableReadyRef: { current: true },
    persistedChoreRowsRef: { current: new Map(server) },
    uncertainChoreWritesRef: { current: new Set() },
    chorePersistenceQueueRef: { current: Promise.resolve() },
    choresRef,
    roommatesRef,
    sharedSnapshotAckRef: { current: { scope: "", payload: "", uncertain: false } },
    latestSharedStateRef: {
      current: { roommates: roommatesRef.current, chores: choresRef.current },
    },
    activeSweet: {},
    isHost: true,
    roommates: roommatesRef.current,
    resolvedHouseholdTimezone: "UTC",
    permissionsForChore: () => ({ canComplete: true }),
    isActiveSweetMember: () => true,
    logChorePermissionCheck: () => {},
    reportSupabaseError: () => {},
    reportRuntimeError: () => {},
    track: { choreCompleted: () => completed++, choreUndone: () => {} },
    choreNow: () => new Date("2026-11-27T16:00:00.000Z"),
    removeMappedReminderIfPresent: async () => {},
    choreToRow,
    rowToChore,
    applyChoreRowEvent,
    planChoreSync,
    sameChoreWrite,
    choreCompletionTransition,
    materializeRecurringOccurrences,
    withoutNormalizedCollections,
    saveFeedback: feedback,
    saveRequest,
    pendingOperations: undefined,
    setChores: (rows: Chore[]) => {
      choresRef.current = rows;
    },
    setRoommates: (rows: any[]) => {
      roommatesRef.current = rows;
    },
    fetchAllRowsByIds: async (ids: string[]) => ({
      data: ids.map((id) => server.get(id)).filter(Boolean),
      error: null,
    }),
    supabase: {
      from: (table: string) => ({
        upsert: (rows: any) => {
          const request = (async () => {
            const payload = JSON.parse(JSON.stringify(rows));
            writes.push({ table, payload });
            if (mode === "pause" && table === "chores")
              await new Promise<void>((done) => {
                release = done;
              });
            if (mode === "offline") return { error: { code: "offline" } };
            if (table === "chores")
              for (const row of payload) server.set(row.id, row);
            else savedState = payload.state;
            if (mode === "lost-ack" && table === "chores") {
              mode = "pass";
              return { error: { code: "ack_lost" } };
            }
            return { error: null };
          })();
          return Object.assign(request, { abortSignal: () => request });
        },
        delete: () => ({
          eq: () => ({
            in: () =>
              Object.assign(Promise.resolve({ error: null }), {
                abortSignal() {
                  return this;
                },
              }),
          }),
        }),
      }),
    },
  };
  const compiled = ts.transpileModule(
    Object.entries(callbacks)
      .map(([name, callback]) => `exports.${name}=${callback};`)
      .join("\n"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  runInNewContext(compiled, bindings);
  Object.assign(bindings, bindings.exports);
  return {
    ...bindings.exports,
    feedback,
    choresRef,
    roommatesRef,
    server,
    writes,
    bindings,
    get completed() {
      return completed;
    },
    get savedState() {
      return savedState;
    },
    mode: (value: string) => {
      mode = value;
    },
    release: () => release?.(),
  };
}
const tick = async () => {
  for (let i = 0; i < 35; i++) await Promise.resolve();
};
{
  const f = fixture();
  f.mode("offline");
  f.setChoreCompleted("chore", true);
  assert.equal(
    f.choresRef.current[0].completed,
    true,
    "checkmark changes before acknowledgement",
  );
  assert.equal(f.roommatesRef.current[0].points, 15);
  await assert.rejects(f.persistChoreChanges());
  await tick();
  assert(
    f.feedback
      .getSnapshot()
      .issues.some((issue: any) => issue.phase === "failed"),
  );
  f.mode("pass");
  await f.feedback.retry("actor:home");
  await tick();
  assert.equal(f.server.get("chore")?.completed, true);
  assert.equal(f.savedState.roommates[0].points, 15);
  assert.equal(
    f.completed,
    1,
    "retry cannot replay completion analytics or award points again",
  );
  assert.equal(f.choresRef.current.length, 1);
  assert.equal(f.feedback.getSnapshot().issues.length, 0);
  f.mode("lost-ack");
  f.setChoreCompleted("chore", false);
  await assert.rejects(f.persistChoreChanges());
  assert.equal(f.server.get("chore")?.completed, false);
  f.mode("pass");
  f.setChoreCompleted("chore", true);
  await f.persistChoreChanges();
  await tick();
  assert.equal(
    f.server.get("chore")?.completed,
    true,
    "an undo of an uncertain write must save even if it matches the older baseline",
  );
  assert.equal(f.roommatesRef.current[0].points, 15);
}
{
  const f = fixture();
  f.mode("pause");
  f.setChoreCompleted("chore", true);
  const older = f.persistChoreChanges();
  await tick();
  f.setChoreCompleted("chore", false);
  const newer = f.persistChoreChanges();
  f.mode("pass");
  f.release();
  await older;
  assert.equal(
    f.choresRef.current[0].completed,
    false,
    "same-millisecond stale acknowledgement must not re-check the latest undo",
  );
  await newer;
  await tick();
  assert.equal(f.server.get("chore")?.completed, false);
  assert.equal(f.roommatesRef.current[0].points, 10);
}
{
  const f = fixture();
  f.mode("pause");
  f.setChoreCompleted("chore", true);
  const save = f.persistChoreChanges().catch((error: unknown) => error);
  await tick();
  f.bindings.activeSetupHouseholdRef.current = "other";
  f.choresRef.current = [];
  f.feedback.setScope("actor:other");
  f.mode("pass");
  f.release();
  await save;
  assert.equal(f.choresRef.current.length, 0);
  assert.equal(f.feedback.getSnapshot().issues.length, 0);
}
console.log(
  "Actual chore callbacks pass immediate checks, failed-save retry without duplicate points, lost acknowledgement, rapid check/undo and household switching.",
);

{
  const f = fixture();
  const batches: any[] = [];
  f.bindings.pendingOperations = { submitBatch: async (steps: any[], scope: string) => {
    batches.push(JSON.parse(JSON.stringify({steps,scope})));
    throw new Error("offline after staging");
  } };
  f.setChoreCompleted("chore", true, "peer");
  assert.equal(f.choresRef.current[0].completed, false, "another actor cannot be credited through this callback");
  f.setChoreCompleted("chore", true, "actor");
  assert.equal(f.choresRef.current[0].completed, true);
  assert.equal(f.roommatesRef.current[0].points, 40);
  assert.equal(batches[0].steps[1].body.state.roommates[0].points, 40, "pickup bonus is included before the batch is staged");
  assert.equal(batches[0].steps[0].body[0].completed, true);
  f.setChoreCompleted("chore", true, "actor");
  assert.equal(batches.length, 1, "repeated intent does not stage another reward");
  await tick();
}
console.log("Pickup completion stages its full reward atomically and refuses repeated or wrong-actor credit");
