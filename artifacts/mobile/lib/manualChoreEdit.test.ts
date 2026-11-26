import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { Chore } from "../context/AppContext.ts";
import { definitionFromChore, choreDefinitionId, sameChore } from "./choreIdentity.ts";
import { choreLocalDateKey, choreScheduledDate, materializeRecurringOccurrences } from "./choreOccurrences.ts";
import { householdDateKey } from "./choreTimezone.ts";
import { parseDueDate } from "./choreForm.ts";

const text = readFileSync("context/AppContext.tsx", "utf8");
const syntax = ts.createSourceFile("AppContext.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback: ts.Expression | undefined;
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(syntax) === "updateChore" && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0];
  ts.forEachChild(node, visit);
}
visit(syntax); assert(callback);
const code = ts.transpileModule(`exports.update = ${callback.getText(syntax)};`, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, esModuleInterop: false, target: ts.ScriptTarget.ES2022,
} }).outputText;
const zone = "America/New_York";
function fixture() {
  const current: Chore = { id: "open", householdId: "home", creatorId: "avery", title: "Counter", assignedTo: "avery", assignmentMode: "specific-person", recurring: "weekly", dueDate: parseDueDate("2026-11-26", zone)!, scheduledDate: "2026-11-26", initialDueDate: parseDueDate("2026-11-26", zone)!, initialScheduledDate: "2026-11-26", recurrenceSeriesId: "series", completed: false, category: "kitchen", points: 2, createdAt: "2026-11-01T12:00:00Z", updatedAt: "2026-11-01T12:00:00Z" };
  const history: Chore = { ...current, id: "history", dueDate: parseDueDate("2026-11-19", zone)!, scheduledDate: "2026-11-19", completed: true, completedAt: "2026-11-19T14:00:00Z" };
  const unrelated: Chore = { ...current, id: "unrelated", recurrenceSeriesId: "other", title: "Other chore" };
  const choresRef = { current: [history, current, unrelated] };
  const originalHistory = JSON.stringify(history);
  let saved: Chore[] = [], allowed = true;
  const exports: any = {};
  runInNewContext(code, { exports, choresRef, applyingChartRef: { current: false }, householdId: "home", roommates: [{ id: "avery" }, { id: "blake" }],
    canManageChore: () => allowed, definitionFromChore, choreDefinitionId, sameChore, materializeRecurringOccurrences, choreLocalDateKey, choreScheduledDate,
    resolvedHouseholdTimezone: zone, householdDateKey, choreNow: () => new Date("2026-11-26T18:00:00Z"), setChores: (value: Chore[]) => { saved = value; },
  });
  return { update: exports.update, choresRef, current, history, originalHistory, result: () => saved, deny: () => { allowed = false; } };
}
{
  const f = fixture();
  assert.equal(f.update("open", { title: "Edited counter", assignedTo: "blake", assignmentMode: "specific-person" }), true);
  const edited = f.result().find(c => c.id === "open")!;
  assert.equal(edited.assignedTo, "blake", "manual reassign must move this obligation to the selected roommate");
  assert.equal(edited.title, "Edited counter"); assert.equal(edited.assignmentLocked, true);
  const history = f.result().find(c => c.id === "history")!;
  assert.equal(history.assignedTo, f.history.assignedTo); assert.equal(history.dueDate, f.history.dueDate); assert.equal(history.completedAt, f.history.completedAt);
  assert.equal(f.result().find(c => c.id === "unrelated")!.assignedTo, "avery");
}
{
  const f = fixture(), nextDay = "2026-11-27", dueDate = parseDueDate(nextDay, zone)!;
  assert.equal(f.update("open", { dueDate, scheduledDate: nextDay, assignedTo: "blake" }), true);
  const edited = f.result().find(c => c.id === "open")!;
  assert.equal(edited.scheduledDate, nextDay, "manual date edits must take effect on the selected obligation");
  assert.equal(edited.dueDate, dueDate); assert.equal(edited.assignedTo, "blake");
  assert(edited.excludedOccurrenceDates?.includes("2026-11-26"), "moving a recurring chore must not regenerate its vacated old date");
  assert.equal(f.result().filter(c => c.id !== "history" && c.id !== "unrelated" && !c.skippedAt && !c.completed).length, 1);
}
{
  const f = fixture(); f.deny(); assert.equal(f.update("open", { assignedTo: "blake" }), false); assert.equal(f.result().length, 0);
}
{
  const f = fixture(); assert.equal(f.update("history", { assignedTo: "blake" }), false);
  assert.equal(JSON.stringify(f.choresRef.current[0]), f.originalHistory, "completed history cannot be edited");
  assert.equal(f.update("open", { assignedTo: "removed-member" }), false);
  f.update("open", { householdId: "another-home" });
  assert.equal(f.choresRef.current.find(c => c.id === "open")!.householdId, "home", "manual edits cannot move records into another household");
}
console.log("Manual chore reassignment/date edit, permissions, recurrence and completed-history tests passed");
