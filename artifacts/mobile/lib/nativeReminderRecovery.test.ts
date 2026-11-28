import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { DurableOperations } from "./durableOperations.ts";
import { SaveFeedbackStore } from "./saveFeedback.ts";
const disk = new Map<string, string>(),
  native = new Map<string, any>(),
  feedback = new SaveFeedbackStore();
feedback.setScope("avery:home");
let loseAck = true,
  creates = 0,
  prompts = 0,
  actor = "avery",
  allowed = true,
  lookupFails = false;
const storage = {
  getItem: async (key: string) => disk.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    disk.set(key, value);
  },
  removeItem: async (key: string) => {
    disk.delete(key);
  },
};
const calendar = {
  EntityTypes: { REMINDER: "reminder" },
  getRemindersPermissionsAsync: async () => ({
    granted: allowed,
    canAskAgain: false,
  }),
  requestRemindersPermissionsAsync: async () => {
    prompts++;
    return { granted: true };
  },
  getCalendarsAsync: async () => [
    { id: "list", title: "SweetMate", allowsModifications: true },
  ],
  getRemindersAsync: async () => {
    if (lookupFails) throw Error("List unavailable");
    return [...native.values()];
  },
  getReminderAsync: async (id: string) => {
    if (!native.has(id)) throw Error("not found");
    return native.get(id);
  },
  updateReminderAsync: async (id: string, details: any) => {
    native.set(id, { ...details, id });
  },
  createReminderAsync: async (_list: string, details: any) => {
    creates++;
    const id = "native-" + creates;
    native.set(id, { ...details, id });
    if (loseAck) {
      loseAck = false;
      throw Error("OS committed before acknowledgement");
    }
    return id;
  },
};
let id = 0;
function boot() {
  const exports: any = {};
  const code = ts.transpileModule(
    readFileSync("lib/externalTasks.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  runInNewContext(code, {
    exports,
    Map,
    Date,
    Error,
    Promise,
    encodeURIComponent,
    process: { env: {} },
    require: (name: string) => {
      if (name === "./calendarTransport") return {};
      if (name === "expo-crypto") return { randomUUID: () => "export-" + ++id };
      if (name === "./durableOperations") return { DurableOperations };
      if (name === "./saveFeedback") return { saveFeedback: feedback };
      if (name === "@react-native-async-storage/async-storage") return storage;
      if (name === "expo-calendar/legacy") return calendar;
      if (name === "react-native") return { Platform: { OS: "ios" } };
      if (name === "./supabase")
        return {
          supabase: {
            auth: {
              getSession: async () => ({
                data: { session: { user: { id: actor } } },
              }),
            },
          },
        };
      throw Error(name);
    },
  });
  return exports;
}
const chore = {
  id: "unique-chore",
  title: "Test task",
  dueDate: "2026-12-01T12:00:00Z",
};
let app = boot();
const failed = await app.exportChoresToExternalTasks("avery", [chore]);
assert.equal(failed.failures.length, 1);
assert.equal(native.size, 1);
assert(
  [...disk.keys()].some((key) => key.startsWith("@sweetmate/reminder-outbox")),
);
// Discard every module-local mapping/engine, retaining only disk + OS records.
app = boot();
await app.resumePendingReminderExports("avery");
assert.equal(native.size, 1);
assert.equal(creates, 1);
assert.equal(prompts, 0);
assert.equal(
  JSON.parse(disk.get("@sweetmate/reminder-outbox/v1/avery")!).operations
    .length,
  0,
);
// Lookup failure never blindly creates another reminder.
lookupFails = true;
const result = await app.exportChoresToExternalTasks("avery", [
  { ...chore, id: "second" },
]);
assert.equal(result.failures.length, 1);
assert.equal(creates, 1);
lookupFails = false;
actor = "blake";
app = boot();
await app.resumePendingReminderExports("avery");
assert.equal(creates, 1);
console.log(
  "iOS reminder restart model passed: OS commit before mapping, stable-marker reconciliation, no blind duplicate on failed lookup, no permission prompts or cross-account replay",
);
