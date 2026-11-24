import { householdDueDate } from "./choreTimezone.ts";

export function dateInput(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function todayDateInput(now = new Date()): string {
  return dateInput(now);
}

export function tomorrowDateInput(now = new Date()): string {
  const date = new Date(now);
  date.setDate(date.getDate() + 1);
  return dateInput(date);
}

export function parseDueDate(value: string, timezone?: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const due = new Date(year, month - 1, day, 23, 59, 0, 0);
  if (
    due.getFullYear() !== year ||
    due.getMonth() !== month - 1 ||
    due.getDate() !== day
  ) {
    return null;
  }
  return timezone
    ? householdDueDate(value.trim(), 23, timezone, 59)
    : due.toISOString();
}
