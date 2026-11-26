export type NormalizedRow = {
  id: string;
  household_id: string;
  updated_at: string;
};

// PostgreSQL JSONB key order and server-written timestamps are not user edits.
// Comparing their serialized transport forms caused an endless write/echo loop.
export function normalizedRowFingerprint(row: NormalizedRow): string {
  const { updated_at: _serverTime, ...values } = row as NormalizedRow & { entry?: Record<string, unknown> };
  if (values.entry) {
    const { updatedAt: _entryTime, ...entry } = values.entry;
    values.entry = entry;
  }
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]),
    );
    return value;
  };
  return JSON.stringify(stable(values));
}

export function planNormalizedSync<T, R extends NormalizedRow>(
  entities: readonly T[],
  persisted: ReadonlyMap<string, R>,
  toRow: (entity: T) => R,
  canonicalize: (row: R) => R = row => row,
) {
  const rows = entities.map(toRow);
  const localIds = new Set(rows.map((row) => row.id));
  return {
    upserts: rows.filter((row) => {
      const prior = persisted.get(row.id);
      return !prior || normalizedRowFingerprint(canonicalize(prior)) !== normalizedRowFingerprint(canonicalize(row));
    }),
    deleteIds: [...persisted.keys()].filter((id) => !localIds.has(id)).sort(),
  };
}

type PendingChanges = { deletedIds?: ReadonlySet<string>; upsertIds?: ReadonlySet<string> };
export function applyNormalizedEvent<T extends { id: string; updatedAt?: string }, R extends NormalizedRow>(
  entities: T[],
  eventType: "INSERT" | "UPDATE" | "DELETE",
  row: R,
  fromRow: (row: R) => T,
  pending: PendingChanges = {},
): T[] {
  const index = entities.findIndex((entity) => entity.id === row.id);
  if (eventType === "DELETE") return index < 0 ? entities : entities.filter((entity) => entity.id !== row.id);
  if (pending.deletedIds?.has(row.id) || pending.upsertIds?.has(row.id)) return entities;
  const incoming = fromRow(row);
  if (index < 0) return [...entities, incoming];
  if (Date.parse(entities[index].updatedAt ?? "") > Date.parse(row.updated_at)) return entities;
  if (JSON.stringify(entities[index]) === JSON.stringify(incoming)) return entities;
  const next = [...entities];
  next[index] = incoming;
  return next;
}
