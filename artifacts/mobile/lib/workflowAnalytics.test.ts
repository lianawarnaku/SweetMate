import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { workflowFailureProperties } from "./workflowAnalytics.ts";

const examples: [string, unknown, string, string, string][] = [
  ["Supabase: sign in", { status: 400, code: "invalid_credentials", message: "private email" }, "auth", "sign_in", "validation"],
  ["google sign in", new Error("Network request failed at https://private.invalid"), "auth", "sign_in", "network"],
  ["sign up", { code: "signup_disabled", status: 422 }, "auth", "sign_up", "permission"],
  ["Supabase: persist normalized chores", { code: "42501", details: "household-id" }, "chore", "chore_update", "permission"],
  ["create draft household", { status: 503 }, "household", "household_update", "server"],
  ["save household setup draft", new Error("private text"), "storage", "storage_update", "storage"],
  ["Supabase: persist normalized shopping_items", { code: "23505" }, "shopping", "shopping_update", "validation"],
  ["Supabase: persist normalized expenses", { status: 403 }, "expense", "expense_update", "permission"],
  ["Add chore to personal calendar", { name: "NotAllowedError" }, "calendar", "calendar_export", "permission"],
  ["Load calendar destination preference", { code: "ETIMEDOUT" }, "calendar", "calendar_update", "network"],
  ["subscribe to private borrowing entries", { status: 429 }, "sync", "sync", "server"],
  ["private freeform action name", { code: "secret-code", message: "secret-message", stack: "secret-stack" }, "sync", "unknown", "unknown"],
];
for (const [action, error, feature, operation, error_category] of examples) {
  const result = workflowFailureProperties(action, error);
  assert.deepEqual(result, { feature, operation, error_category });
  assert.deepEqual(Object.keys(result).sort(), ["error_category", "feature", "operation"]);
}

// Exercise the actual reporter and prove that only its fixed mapper output is
// offered to analytics, independently of the diagnostic-exception path.
const events: unknown[] = [];
const diagnostics: unknown[] = [];
const compiled = ts.transpileModule(readFileSync(resolve(process.cwd(), "lib/runtimeDiagnostics.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const exports: Record<string, unknown> = {};
const fakeConsole = { error: (..._args: unknown[]) => {} };
runInNewContext(compiled, {
  exports,
  console: fakeConsole,
  require: (name: string) => {
    if (name === "@/lib/workflowAnalytics") return { workflowFailureProperties };
    if (name === "@/lib/analytics") return {
      track: { workflowFailed: (properties: unknown) => events.push(properties) },
      captureDiagnosticException: (...args: unknown[]) => diagnostics.push(args),
    };
    throw new Error(`unexpected module: ${name}`);
  },
});
const reporter = exports as typeof import("./runtimeDiagnostics");
reporter.reportRuntimeError("sign in", { status: 401, message: "private-message", code: "private-code" }, {
  email: "private@example.invalid", token: "private-token", householdId: "private-id",
});
assert.deepEqual(events, [{ feature: "auth", operation: "sign_in", error_category: "permission" }]);
assert.equal(diagnostics.length, 1, "diagnostic path remains independent");
const cleanup = reporter.installGlobalRuntimeDiagnostics();
fakeConsole.error(new Error("private-console-error"));
assert.equal(events.length, 1, "ordinary console logging must not produce workflow analytics");
cleanup();
console.log("workflow analytics privacy and classification tests passed");
