const NORMALIZED_KEYS = [
  "chores",
  "expenses",
  "shoppingLists",
  "shoppingItems",
  "shoppingSyncMeta",
  "borrowItems",
] as const;

/** Remove collections whose canonical storage is now a normalized table. */
export function withoutNormalizedCollections<T extends object>(state: T) {
  const payload = { ...state } as Record<string, unknown>;
  NORMALIZED_KEYS.forEach((key) => delete payload[key]);
  return payload;
}
