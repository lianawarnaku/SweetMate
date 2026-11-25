export type ShoppingSchedule = { date: string; time?: string };

export function validShoppingTime(value: string | undefined): string | undefined {
  return value && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : undefined;
}

export function shoppingTimeFromClock(hour: string, minute: string, period: "AM" | "PM"): string | null {
  if (!/^\d{1,2}$/.test(hour) || !/^\d{1,2}$/.test(minute)) return null;
  const h = Number(hour), m = Number(minute);
  if (h < 1 || h > 12 || m > 59) return null;
  return `${String(h % 12 + (period === "PM" ? 12 : 0)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatShoppingTime(time: string | undefined): string {
  if (!validShoppingTime(time)) return "All day";
  const [hour, minute] = time!.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

export function formatShoppingSchedule(value: ShoppingSchedule): string {
  const date = new Date(`${value.date}T12:00:00`);
  const label = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${label} · ${formatShoppingTime(value.time)}`;
}

export function shoppingMonthDays(month: Date): Date[] {
  const start = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start); day.setDate(start.getDate() + index); return day;
  });
}
