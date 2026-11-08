import type {
  Chore,
  Expense,
  Roommate,
  ShoppingItem,
  ShoppingList,
} from "@/context/AppContext";

export type CalendarItemType =
  | "chore"
  | "shopping-item"
  | "shopping-list"
  | "expense";

export interface CalendarItem {
  id: string;
  sourceId: string;
  occurrenceId: string;
  type: CalendarItemType;
  title: string;
  description?: string;
  date: string;
  time?: string;
  isRecurring: boolean;
  recurrenceLabel?: string;
  completed?: boolean;
  amountCents?: number;
  assigneeId?: string;
  payerId?: string;
}

export interface CalendarSources {
  chores: Chore[];
  shoppingItems: ShoppingItem[];
  shoppingLists: ShoppingList[];
  expenses: Expense[];
  roommates: Roommate[];
  currentUserId: string;
  householdId: string | null;
}

const DAY_MS = 86_400_000;

/** Formats a Date as a local date-only key without UTC conversion. */
export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Parses date-only values at local noon so DST/UTC conversions cannot move a day. */
export function localCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
  if (match && !value.includes("T")) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12);
}

function addMonthsClamped(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  result.setDate(Math.min(day, new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()));
  return result;
}

function nextOccurrence(date: Date, recurrence: string): Date | null {
  if (recurrence === "monthly") return addMonthsClamped(date, 1);
  const days =
    recurrence === "daily" ? 1 :
    recurrence === "weekly" ? 7 :
    recurrence === "biweekly" ? 14 :
    null;
  if (!days) return null;
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function occurrencesInRange(
  startValue: string,
  recurrence: string | undefined,
  rangeStart: Date,
  rangeEnd: Date,
): Date[] {
  const first = localCalendarDate(startValue);
  if (!first) return [];
  if (!recurrence) return first >= rangeStart && first <= rangeEnd ? [first] : [];
  const result: Date[] = [];
  let cursor = first;
  // Range generation is bounded; this guard also protects malformed legacy rules.
  for (let index = 0; index < 500 && cursor <= rangeEnd; index += 1) {
    if (cursor >= rangeStart) result.push(cursor);
    const next = nextOccurrence(cursor, recurrence);
    if (!next || next <= cursor) break;
    cursor = next;
  }
  return result;
}

function occurrenceKey(type: CalendarItemType, sourceId: string, date: Date): string {
  return `${type}:${sourceId}:${localDateKey(date)}`;
}

export function deriveCalendarItems(
  sources: CalendarSources,
  visibleStart: Date,
  visibleEnd: Date,
): CalendarItem[] {
  const rangeStart = new Date(visibleStart.getFullYear(), visibleStart.getMonth(), visibleStart.getDate(), 0);
  const rangeEnd = new Date(visibleEnd.getFullYear(), visibleEnd.getMonth(), visibleEnd.getDate(), 23, 59, 59, 999);
  const result = new Map<string, CalendarItem>();
  const roommateName = new Map(sources.roommates.map((roommate) => [roommate.id, roommate.name]));

  for (const chore of sources.chores) {
    if (
      chore.assignedTo !== sources.currentUserId ||
      (sources.householdId && chore.householdId && chore.householdId !== sources.householdId)
    ) continue;
    // Chores are durable occurrence records. Do not project a recurring
    // occurrence from every stored row: that creates duplicates and can
    // regenerate historical work. Completed occurrences live on their
    // completion day; unresolved/future occurrences live on their due day.
    const date = localCalendarDate(
      chore.completed && chore.completedAt ? chore.completedAt : chore.dueDate,
    );
    if (!date || date < rangeStart || date > rangeEnd) continue;
    const key = occurrenceKey("chore", chore.id, date);
    result.set(key, {
      id: key,
      sourceId: chore.id,
      occurrenceId: chore.id,
      type: "chore",
      title: chore.title,
      description: `Assigned to ${roommateName.get(chore.assignedTo) ?? "you"} · due ${localDateKey(localCalendarDate(chore.dueDate) ?? date)}`,
      date: localDateKey(date),
      isRecurring: Boolean(chore.recurring),
      recurrenceLabel: chore.recurring,
      completed: chore.completed,
      assigneeId: chore.assignedTo,
    });
  }

  for (const list of sources.shoppingLists) {
    if (!list.plannedDate) continue;
    const date = localCalendarDate(list.plannedDate);
    if (!date || date < rangeStart || date > rangeEnd) continue;
    const key = occurrenceKey("shopping-list", list.id, date);
    result.set(key, {
      id: key, sourceId: list.id, occurrenceId: key, type: "shopping-list",
      title: list.name, description: "Planned shopping list", date: localDateKey(date),
      isRecurring: false, assigneeId: list.assignedTo,
    });
  }

  for (const item of sources.shoppingItems) {
    if (!item.neededByDate || item.convertedExpenseId) continue;
    const date = localCalendarDate(item.neededByDate);
    if (!date || date < rangeStart || date > rangeEnd) continue;
    const key = occurrenceKey("shopping-item", item.id, date);
    result.set(key, {
      id: key, sourceId: item.id, occurrenceId: key, type: "shopping-item",
      title: item.name, description: item.completed ? "Purchased" : "Needed by this date",
      date: localDateKey(date), isRecurring: false, completed: item.completed,
    });
  }

  for (const expense of sources.expenses) {
    // The shared expense source has already applied household access rules.
    // A legacy recurrence label is metadata, not a separate repayable IOU.
    // Show only the actual saved record until expense series are implemented.
    for (const date of occurrencesInRange(expense.date, undefined, rangeStart, rangeEnd)) {
      const key = occurrenceKey("expense", expense.id, date);
      const isStoredOccurrence = localDateKey(localCalendarDate(expense.date) ?? date) === localDateKey(date);
      result.set(key, {
        id: key, sourceId: expense.id, occurrenceId: key, type: "expense",
        title: expense.title,
        description: `${expense.settled ? "Settled" : "Unsettled"} · paid by ${roommateName.get(expense.paidBy) ?? "a Sweetmate"}`,
        date: localDateKey(date), isRecurring: false,
        completed: isStoredOccurrence ? expense.settled : false,
        amountCents: Math.round(expense.amount * 100), payerId: expense.paidBy,
      });
    }
  }

  return [...result.values()].sort((left, right) =>
    left.date.localeCompare(right.date) || left.type.localeCompare(right.type) || left.title.localeCompare(right.title)
  );
}

export function groupCalendarItemsByDate(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const grouped = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const day = grouped.get(item.date);
    if (day) day.push(item);
    else grouped.set(item.date, [item]);
  }
  return grouped;
}
