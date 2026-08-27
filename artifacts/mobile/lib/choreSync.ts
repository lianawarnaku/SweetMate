import type { Chore } from "../context/AppContext.ts";
import { choreToRow, rowToChore, type ChoreRow } from "./choreRow.ts";

export type ChoreSyncPlan = {
  upserts: ChoreRow[];
  deleteIds: string[];
};

/**
 * Build an idempotent row-level persistence plan. Supplying the IDs observed
 * in the table makes removals explicit, so occurrence/future/series deletion
 * cannot leave normalized orphan rows behind.
 */
export function planChoreSync(
  chores: readonly Chore[],
  persisted: ReadonlyMap<string, ChoreRow> | ReadonlySet<string>,
): ChoreSyncPlan {
  const localRows = chores
    .map(choreToRow)
    .filter((row): row is ChoreRow => row !== null);
  const localIds = new Set(localRows.map((row) => row.id));
  const persistedIds = new Set(persisted.keys());
  const upserts = localRows.filter((row) => {
    if (!(persisted instanceof Map)) return true;
    const previous = persisted.get(row.id);
    return !previous || JSON.stringify(previous) !== JSON.stringify(row);
  });
  return {
    upserts,
    deleteIds: [...persistedIds].filter((id) => !localIds.has(id)).sort(),
  };
}

/** Apply one Supabase Realtime event without duplicating rows. */
export function applyChoreRowEvent(
  chores: readonly Chore[],
  eventType: "INSERT" | "UPDATE" | "DELETE",
  row: ChoreRow,
): Chore[] {
  if (eventType === "DELETE") return chores.filter((chore) => chore.id !== row.id);
  const incoming = rowToChore(row);
  const index = chores.findIndex((chore) => chore.id === incoming.id);
  if (index < 0) return [...chores, incoming];
  if ((chores[index].updatedAt ?? "") > (incoming.updatedAt ?? "")) return [...chores];
  const next = [...chores];
  next[index] = incoming;
  return next;
}

export function choreParity(
  chores: readonly Chore[],
  rows: readonly ChoreRow[],
): { missing: string[]; extra: string[]; mismatched: string[] } {
  const expected = new Map(
    chores.flatMap((chore) => {
      const row = choreToRow(chore);
      return row ? [[row.id, row] as const] : [];
    }),
  );
  const actual = new Map(rows.map((row) => [row.id, row]));
  const missing = [...expected.keys()].filter((id) => !actual.has(id)).sort();
  const extra = [...actual.keys()].filter((id) => !expected.has(id)).sort();
  const mismatched = [...expected.entries()]
    .filter(([id, row]) => actual.has(id) && JSON.stringify(actual.get(id)) !== JSON.stringify(row))
    .map(([id]) => id)
    .sort();
  return { missing, extra, mismatched };
}
