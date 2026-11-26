import type { Chore } from "../context/AppContext.ts";
import { choreToRow, rowToChore, type ChoreRow } from "./choreRow.ts";

export type ChoreSyncPlan = { upserts: ChoreRow[]; deleteIds: string[] };
type ChoreRowEvent = "INSERT" | "UPDATE" | "DELETE";

function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sortedJson(entry)]));
  return value;
}

/** Compare writable values, independent of PostgREST/JSONB property order. */
function rowFingerprint(row: ChoreRow): string {
  const normalized = choreToRow(rowToChore(row))!;
  for (const key of ["due_date", "initial_due_date", "next_due_date", "completed_at", "created_at", "updated_at", "skipped_at"] as const) {
    const stamp = normalized[key];
    if (stamp && Number.isFinite(Date.parse(stamp))) normalized[key] = new Date(stamp).toISOString();
  }
  return JSON.stringify(sortedJson(normalized));
}

/** Plan writes only for changed chores; removals remain explicit. */
export function planChoreSync(chores: readonly Chore[], persisted: ReadonlyMap<string, ChoreRow> | ReadonlySet<string>): ChoreSyncPlan {
  const localRows = chores.map(choreToRow).filter((row): row is ChoreRow => row !== null);
  const localIds = new Set(localRows.map((row) => row.id));
  const upserts = localRows.filter((row) => {
    if (!(persisted instanceof Map)) return true;
    const previous = persisted.get(row.id);
    return !previous || rowFingerprint(previous) !== rowFingerprint(row);
  });
  return { upserts, deleteIds: [...persisted.keys()].filter((id) => !localIds.has(id)).sort() };
}

export function applyChoreRowEvent(chores: Chore[], eventType: ChoreRowEvent, row: ChoreRow): Chore[];
export function applyChoreRowEvent(chores: readonly Chore[], eventType: ChoreRowEvent, row: ChoreRow): readonly Chore[];
/** Replayed/unchanged events retain the snapshot instead of requeuing writes. */
export function applyChoreRowEvent(chores: readonly Chore[], eventType: ChoreRowEvent, row: ChoreRow): readonly Chore[] {
  const index = chores.findIndex((chore) => chore.id === row.id);
  if (eventType === "DELETE") return index < 0 ? chores : chores.filter((chore) => chore.id !== row.id);
  const incoming = rowToChore(row);
  if (index < 0) return [...chores, incoming];
  const existing = chores[index];
  if (Date.parse(existing.updatedAt ?? "") > Date.parse(incoming.updatedAt ?? "")) return chores;
  const previous = choreToRow(existing);
  if (previous && rowFingerprint(previous) === rowFingerprint(row)) return chores;
  const next = [...chores]; next[index] = incoming;
  return next;
}

export function choreParity(chores: readonly Chore[], rows: readonly ChoreRow[]): { missing: string[]; extra: string[]; mismatched: string[] } {
  const expected = new Map(chores.flatMap((chore) => { const row = choreToRow(chore); return row ? [[row.id, row] as const] : []; }));
  const actual = new Map(rows.map((row) => [row.id, row]));
  return {
    missing: [...expected.keys()].filter((id) => !actual.has(id)).sort(),
    extra: [...actual.keys()].filter((id) => !expected.has(id)).sort(),
    mismatched: [...expected.entries()].filter(([id, row]) => actual.has(id) && rowFingerprint(actual.get(id)!) !== rowFingerprint(row)).map(([id]) => id).sort(),
  };
}

/** Recover missed live events without dropping edits made during the read. */
export function mergeChoreSnapshot(local: readonly Chore[], baseline: ReadonlyMap<string, ChoreRow>, remote: readonly ChoreRow[]): Chore[] {
  const pending = planChoreSync(local, baseline);
  let merged = remote.map(rowToChore);
  for (const row of pending.upserts) merged = applyChoreRowEvent(merged, "UPDATE", row);
  const deleted = new Set(pending.deleteIds);
  return merged.filter(chore => !deleted.has(chore.id));
}
