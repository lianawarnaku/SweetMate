type FocusCandidate = {
  completed: boolean;
  dueDate: string;
};

/**
 * Selects the clearest next action for the Home summary without changing the
 * order of the underlying chore list. Overdue chores naturally rank first
 * because their due timestamps are earlier than upcoming chores.
 */
export function selectUpNextChore<T extends FocusCandidate>(chores: readonly T[]): T | undefined {
  let selected: T | undefined;
  let selectedDueTime = Number.POSITIVE_INFINITY;

  for (const chore of chores) {
    if (chore.completed) continue;

    const parsedDueTime = new Date(chore.dueDate).getTime();
    const dueTime = Number.isFinite(parsedDueTime)
      ? parsedDueTime
      : Number.POSITIVE_INFINITY;

    if (!selected || dueTime < selectedDueTime) {
      selected = chore;
      selectedDueTime = dueTime;
    }
  }

  return selected;
}


/** Check current personal lists rather than remembering a previous completion. */
export function isHomeCaughtUp({ chores, shoppingItems, scheduleItems }: {
  chores: readonly { completed: boolean; skippedAt?: string }[];
  shoppingItems: readonly { completed: boolean }[];
  scheduleItems: readonly { source: "google-task" | "google-event"; app_completed_at: string | null }[];
}): boolean {
  return !chores.some(chore => !chore.completed && !chore.skippedAt)
    && !shoppingItems.some(item => !item.completed)
    && !scheduleItems.some(item => !item.app_completed_at);
}
