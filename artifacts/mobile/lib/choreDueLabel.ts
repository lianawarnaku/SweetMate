/** Calendar labels must compare dates, not round the remaining hours. */
export function choreDueLabel(value: string, now = new Date()): string {
  const due = new Date(value);
  if (!Number.isFinite(due.getTime())) return "Date unavailable";
  const day = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((day(due) - day(now)) / 86_400_000);
  if (days < 0) return `Overdue · originally due ${due.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `${days}d left`;
}
