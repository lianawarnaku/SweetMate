export type NormalizedRow = {
  id: string;
  household_id: string;
  updated_at: string;
};

export function planNormalizedSync<T, R extends NormalizedRow>(
  entities: readonly T[],
  persisted: ReadonlyMap<string, R>,
  toRow: (entity: T) => R,
) {
  const rows = entities.map(toRow);
  const localIds = new Set(rows.map((row) => row.id));
  return {
    upserts: rows.filter((row) => {
      const prior = persisted.get(row.id);
      return !prior || JSON.stringify(prior) !== JSON.stringify(row);
    }),
    deleteIds: [...persisted.keys()].filter((id) => !localIds.has(id)).sort(),
  };
}

export function applyNormalizedEvent<T extends { id: string; updatedAt?: string }, R extends NormalizedRow>(
  entities: readonly T[],
  eventType: "INSERT" | "UPDATE" | "DELETE",
  row: R,
  fromRow: (row: R) => T,
): T[] {
  if (eventType === "DELETE") return entities.filter((entity) => entity.id !== row.id);
  const incoming = fromRow(row);
  const index = entities.findIndex((entity) => entity.id === row.id);
  if (index < 0) return [...entities, incoming];
  if ((entities[index].updatedAt ?? "") > row.updated_at) return [...entities];
  const next = [...entities];
  next[index] = incoming;
  return next;
}
