/** Financial dates are calendar days, never UTC instants. */
export function expenseDateInputValue(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear().toString().padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function normalizeExpenseDate(input: string | Date): string | null {
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : expenseDateInputValue(input);
  const matched = /^(\d{4})-(\d{2})-(\d{2})(?:$|T\d{2}:\d{2})/.exec(input);
  if (!matched) return null;
  const [, yearText, monthText, dayText] = matched;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  // UTC is used only to validate calendar arithmetic, never to display the date.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(12, 0, 0, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (input.length > 10 && Number.isNaN(Date.parse(input))) return null;
  return `${yearText}-${monthText}-${dayText}`;
}

export function parseExpenseDate(input: string): Date | null {
  const normalized = normalizeExpenseDate(input);
  if (normalized === null) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  return date;
}

export function formatExpenseDate(input: string): string {
  return parseExpenseDate(input)?.toLocaleDateString("en-US", { month: "short", day: "numeric" }) ?? "";
}
