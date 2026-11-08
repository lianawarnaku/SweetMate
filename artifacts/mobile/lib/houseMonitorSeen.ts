export interface HouseMonitorCompletion {
  id: string;
  completed: boolean;
  completedAt?: string;
}

/** Completion identity survives ordinary chore edits and changes on re-completion. */
export function houseMonitorCompletionTokens(
  chores: readonly HouseMonitorCompletion[],
): string[] {
  const tokens = new Set<string>();
  for (const chore of chores) {
    if (!chore.completed) continue;
    // Optimistic ISO timestamps and database offsets can spell the same instant
    // differently; refreshing must never turn that into another completion.
    const instant = chore.completedAt ? Date.parse(chore.completedAt) : NaN;
    const identity = Number.isFinite(instant)
      ? new Date(instant).toISOString()
      : chore.completedAt || "completed";
    tokens.add(`${chore.id}|${identity}`);
  }
  return [...tokens].sort();
}

/** Null means no usable saved baseline; an empty array is a valid seen-zero state. */
export function parseStoredHouseMonitorSeen(
  raw: string | null | undefined,
): string[] | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !Array.isArray(value) ||
      !value.every(
        (token): token is string =>
          typeof token === "string" &&
          token.lastIndexOf("|") > 0 &&
          !token.endsWith("|"),
      )
    )
      return null;
    return [...new Set(value as string[])].sort();
  } catch {
    return null;
  }
}

/** A first visit celebrates current completions once; counts use identities, not net totals. */
export function getHouseMonitorUnseenCount(
  currentTokens: readonly string[],
  seenTokens: readonly string[] | null,
): number {
  const seen = new Set(seenTokens ?? []);
  return [...new Set(currentTokens)].filter((token) => !seen.has(token)).length;
}

/** Keep each person's viewing history separate for every household. */
export function houseMonitorSeenStorageKey(userId: string, householdId: string): string {
  return `@sweetmate/house-monitor-seen/v1/${encodeURIComponent(userId)}/${encodeURIComponent(householdId)}`;
}
