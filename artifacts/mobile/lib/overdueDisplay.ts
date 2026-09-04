type OverdueDisplayOptions<T> = {
  expanded: boolean;
  isOverdue: (item: T) => boolean;
  keyForRepeatedItem: (item: T) => string;
  maxVisibleOverdue?: number;
};

/**
 * Keeps current work visible while tucking repeated or older overdue entries
 * behind an explicit Show all control. The source collection is never changed.
 */
export function compactOverdueItems<T>(
  items: readonly T[],
  {
    expanded,
    isOverdue,
    keyForRepeatedItem,
    maxVisibleOverdue = 3,
  }: OverdueDisplayOptions<T>,
) {
  if (expanded) return { visibleItems: [...items], hiddenCount: 0 };

  const seenOverdue = new Set<string>();
  let visibleOverdueCount = 0;
  const visibleItems = items.filter((item) => {
    if (!isOverdue(item)) return true;
    const key = keyForRepeatedItem(item);
    if (seenOverdue.has(key) || visibleOverdueCount >= maxVisibleOverdue) return false;
    seenOverdue.add(key);
    visibleOverdueCount += 1;
    return true;
  });

  return { visibleItems, hiddenCount: items.length - visibleItems.length };
}
