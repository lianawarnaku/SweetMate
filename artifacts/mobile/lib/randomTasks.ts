import type { ChoreRow } from "./choreRow.ts";

export type RandomTaskMode = "up-for-grabs" | "random";
export interface RandomTask {
  id: string;
  householdId: string;
  title: string;
  mode: RandomTaskMode;
  createdBy: string | null;
  createdAt: string;
  claimDeadline: string | null;
  assignedAt: string | null;
  assignmentKind: "claimed" | "random" | null;
  assignedTo: string | null;
  choreId: string | null;
  completed: boolean;
  dueAt: string | null;
}
export interface RandomTaskInput { id: string; title: string; mode: RandomTaskMode }
export interface RandomTasksSnapshot { householdId: string; serverNow: string; tasks: RandomTask[]; chores: ChoreRow[] }

export function parseRandomTasksSnapshot(data: unknown, householdId: string): RandomTasksSnapshot {
  if (!data || typeof data !== "object") throw new Error("Random tasks could not be loaded.");
  const raw = data as Record<string, unknown>;
  if (raw.householdId !== householdId || !Array.isArray(raw.tasks) || !Array.isArray(raw.chores)
    || typeof raw.serverNow !== "string" || !Number.isFinite(Date.parse(raw.serverNow))) throw new Error("Random tasks could not be loaded for this household.");
  const tasks: RandomTask[] = raw.tasks.map((value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("A shared random task could not be loaded.");
    const row = value as Record<string, unknown>;
    if (row.household_id !== householdId || typeof row.id !== "string" || typeof row.title !== "string"
      || (row.mode !== "up-for-grabs" && row.mode !== "random") || typeof row.created_at !== "string") throw new Error("A shared random task could not be loaded.");
    const text = (key: string) => typeof row[key] === "string" ? row[key] as string : null;
    return { id: row.id, householdId, title: row.title, mode: row.mode, createdBy: text("created_by"), createdAt: row.created_at,
      claimDeadline: text("claim_deadline"), assignedAt: text("assigned_at"), assignedTo: text("assigned_to"),
      assignmentKind: row.assignment_kind === "claimed" || row.assignment_kind === "random" ? row.assignment_kind : null,
      choreId: text("chore_id"), completed: row.completed === true, dueAt: text("due_at") };
  });
  const choreIds = new Set(tasks.flatMap((task) => task.choreId ? [task.choreId] : []));
  const chores = (raw.chores as ChoreRow[]).filter((row) => row && row.household_id === householdId && choreIds.has(row.id));
  return { householdId, serverNow: raw.serverNow, tasks, chores };
}

export function randomTaskClaimTime(task: RandomTask, now: number): string {
  if (!task.claimDeadline) return "Assigning randomly…";
  const remaining = Date.parse(task.claimDeadline) - now;
  if (remaining <= 0) return "Claim window closed · assigning randomly…";
  const minutes = Math.ceil(remaining / 60_000);
  const hours = Math.floor(minutes / 60);
  return `${hours ? `${hours}h ` : ""}${minutes % 60 || !hours ? `${minutes % 60}m ` : ""}left to claim`;
}
