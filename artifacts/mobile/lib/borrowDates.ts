/** Borrow forms use local calendar dates; UTC conversion must not shift them. */
export function borrowDateInput(value: Date | string = new Date(), daysFromToday = 0): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  date.setDate(date.getDate() + daysFromToday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function borrowDaysUntil(value: string, now = new Date()): number {
  const due = new Date(value), today = new Date(now);
  if (!Number.isFinite(due.getTime()) || !Number.isFinite(today.getTime())) return NaN;
  due.setHours(12, 0, 0, 0); today.setHours(12, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}
