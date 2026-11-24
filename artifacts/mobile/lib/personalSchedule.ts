export interface PersonalScheduleItem {
  id: string; user_id: string; source: "google-event" | "google-task"; resource_id: string; provider_id: string; title: string;
  starts_at: string | null; ends_at: string | null; starts_on: string | null; ends_on: string | null;
  busy: boolean; link: string | null; app_completed_at: string | null;
  override_start: string | null; override_end: string | null; period_override: "morning" | "night" | null;
}
export interface SchedulePreferences { user_id: string; enabled: boolean; calendar_ids: string[]; task_list_ids: string[]; timezone: string; synced_at: string | null; sync_error: string | null }
export interface ScheduleSources { calendars: { id: string; name: string }[]; taskLists: { id: string; name: string }[] }
export interface BusyActivity { member_id: string; ends_at: string }
export type TaskScheduleUpdate = { completed?: boolean; period?: "morning" | "night"; start?: string; end?: string; clearTime?: boolean };

export function scheduleDateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function scheduleItemTimes(item: PersonalScheduleItem) {
  return { start: item.override_start ?? item.starts_at, end: item.override_end ?? item.ends_at };
}
export function scheduleItemProgress(item: PersonalScheduleItem, now: number) {
  const { start, end } = scheduleItemTimes(item);
  if (!start || !end || item.app_completed_at) return null;
  const begins = Date.parse(start), ends = Date.parse(end);
  if (!Number.isFinite(begins) || !Number.isFinite(ends) || ends <= begins || now < begins || now >= ends) return null;
  return { elapsed: (now - begins) / (ends - begins), remainingMs: ends - now, durationMs: ends - begins };
}
export function scheduleItemsForDay(items: PersonalScheduleItem[], day: string, timezone: string): PersonalScheduleItem[] {
  return items.filter((item) => {
    const { start, end } = scheduleItemTimes(item);
    if (start && end) return scheduleDateKey(new Date(start), timezone) <= day && scheduleDateKey(new Date(Date.parse(end) - 1), timezone) >= day;
    if (item.source === "google-task") return item.starts_on === null || item.starts_on === day;
    return item.starts_on !== null && item.starts_on <= day && item.ends_on !== null && item.ends_on > day;
  });
}
export function scheduleItemPeriod(item: PersonalScheduleItem, timezone: string, day?: string): "morning" | "night" {
  const { start } = scheduleItemTimes(item);
  if (start) {
    if (day && scheduleDateKey(new Date(start), timezone) < day) return "morning";
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(new Date(start)));
    return hour < 12 ? "morning" : "night";
  }
  return item.period_override ?? "morning";
}
export function scheduleTimeLabel(item: PersonalScheduleItem, timezone: string) {
  const { start, end } = scheduleItemTimes(item);
  if (!start || !end) return item.source === "google-task" ? "Anytime" : "All day";
  const format = (stamp: string) => new Date(stamp).toLocaleTimeString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" });
  return `${format(start)} – ${format(end)}`;
}
