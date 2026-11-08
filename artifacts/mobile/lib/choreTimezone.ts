export function householdDateKey(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (key: string) =>
    parts.find((entry) => entry.type === key)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Translate a household calendar date/hour into an instant, including DST. */
export function householdDueDate(
  date: string,
  hour: number,
  timezone: string,
  minute = 0,
  second = 0,
  millisecond = 0,
): string {
  const [year, month, day] = date.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = target;
  for (let pass = 0; pass < 3; pass += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const part = (key: string) =>
      Number(parts.find((entry) => entry.type === key)?.value ?? 0);
    const represented = Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour"),
      part("minute"),
      part("second"),
    );
    instant += target - represented;
  }
  return new Date(instant + millisecond).toISOString();
}
