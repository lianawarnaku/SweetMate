/**
 * Reconciles a locally-held list against an incoming whole-household
 * snapshot by comparing each record's `updatedAt` instead of blindly
 * replacing the array. Without this, a local mutation (e.g. settling an
 * expense) racing a stale snapshot upserted by another device can be
 * silently reverted once that snapshot echoes back over Realtime.
 *
 * A record present locally but missing from `remote` is dropped, matching
 * the existing chore-merge behavior: that is how a deletion from another
 * device propagates. There is no tombstone/version column backing this, so
 * a record added locally but not yet round-tripped to the server can be
 * transiently dropped by a remote snapshot that predates it; this mirrors
 * the same accepted tradeoff already made for ordinary (non-occurrence)
 * chore records.
 */
export function mergeByUpdatedAt<T extends { id: string; updatedAt?: string }>(
  local: T[],
  remote: T[],
): T[] {
  const localById = new Map(local.map((item) => [item.id, item]));
  return remote.map((remoteItem) => {
    const localItem = localById.get(remoteItem.id);
    return localItem && (localItem.updatedAt ?? "") > (remoteItem.updatedAt ?? "")
      ? localItem
      : remoteItem;
  });
}
