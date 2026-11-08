/** Explicit state changes make repeated undo requests safe. */
export function setShoppingCompletion<T extends { id: string; completed: boolean; updatedAt?: string }>(
  items: T[], id: string, completed: boolean, updatedAt: string,
): T[] {
  const target = items.find((item) => item.id === id);
  if (!target || target.completed === completed) return items;
  return items.map((item) => item.id === id ? { ...item, completed, updatedAt } : item);
}
