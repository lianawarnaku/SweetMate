import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.0";

export class ScheduleFailure extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}
type GoogleEvent = { id?: string; summary?: string; status?: string; transparency?: string;
  start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[]; htmlLink?: string;
  extendedProperties?: { private?: { sweetmateChoreOccurrenceId?: string } } };
type GoogleTask = { id?: string; title?: string; due?: string; deleted?: boolean; hidden?: boolean; status?: string; webViewLink?: string };
export type ScheduleRow = { id: string; source: "google-event" | "google-task"; resource_id: string; provider_id: string; title: string;
  starts_at: string | null; ends_at: string | null; starts_on: string | null; ends_on: string | null; busy: boolean; link: string | null };

async function itemId(user: string, source: string, resource: string, id: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([user, source, resource, id])));
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}
const dateKey = (value?: string) => value && /^\d{4}-\d{2}-\d{2}/.test(value) && Number.isFinite(Date.parse(value.slice(0, 10))) && new Date(value.slice(0, 10)).toISOString().slice(0, 10) === value.slice(0, 10) ? value.slice(0, 10) : null;
const timestamp = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
export async function normalizeGoogleEvent(user: string, resource: string, event: GoogleEvent): Promise<ScheduleRow | null> {
  if (!event.id || event.status === "cancelled" || event.attendees?.some((person) => person.self && person.responseStatus === "declined")
    || event.extendedProperties?.private?.sweetmateChoreOccurrenceId) return null;
  const start = timestamp(event.start?.dateTime), end = timestamp(event.end?.dateTime);
  const startDay = dateKey(event.start?.date), endDay = dateKey(event.end?.date);
  if (!((start && end && end > start) || (startDay && endDay && endDay > startDay))) return null;
  return { id: await itemId(user, "google-event", resource, event.id), source: "google-event", resource_id: resource, provider_id: event.id,
    title: (event.summary || "Untitled event").slice(0, 1024), starts_at: start, ends_at: end, starts_on: startDay, ends_on: endDay,
    busy: Boolean(start && event.transparency !== "transparent"), link: event.htmlLink?.startsWith("https://") ? event.htmlLink : null };
}
export async function normalizeGoogleTask(user: string, resource: string, task: GoogleTask): Promise<ScheduleRow | null> {
  if (!task.id || task.deleted || task.hidden || task.status === "completed") return null;
  return { id: await itemId(user, "google-task", resource, task.id), source: "google-task", resource_id: resource, provider_id: task.id,
    title: (task.title || "Untitled task").slice(0, 1024), starts_at: null, ends_at: null, starts_on: dateKey(task.due), ends_on: null,
    busy: false, link: task.webViewLink?.startsWith("https://") ? task.webViewLink : null };
}

export function createGoogleScheduleService(admin: SupabaseClient, accessToken: (userId: string) => Promise<string>, request: typeof fetch = fetch) {
  const readPages = async (url: URL, token: string, limit = 5000): Promise<Record<string, unknown>[]> => {
    const items: Record<string, unknown>[] = [];
    let page: string | undefined;
    do {
      if (page) url.searchParams.set("pageToken", page);
      const response = await request(url.toString(), { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
      if (response.status === 401) throw new ScheduleFailure("GOOGLE_RECONNECT_REQUIRED", 401, "Reconnect Google in Settings to sync your schedule.");
      if (response.status === 403) throw new ScheduleFailure("GOOGLE_SCHEDULE_PERMISSION", 403, "Google Calendar or Tasks access is unavailable. Reconnect Google and allow calendar list and task access.");
      if (!response.ok) throw new ScheduleFailure("GOOGLE_SCHEDULE_UNAVAILABLE", 503, "Your Google schedule could not sync. Try again shortly.");
      const body = await response.json() as { items?: Record<string, unknown>[]; nextPageToken?: string };
      if (body.items && !Array.isArray(body.items)) throw new ScheduleFailure("INVALID_GOOGLE_RESPONSE", 503, "Google returned an incomplete schedule.");
      items.push(...(body.items ?? []));
      if (items.length > limit) throw new ScheduleFailure("SCHEDULE_TOO_LARGE", 400, "Choose fewer calendars or task lists to sync.");
      if (body.nextPageToken && body.nextPageToken === page) throw new ScheduleFailure("INVALID_GOOGLE_RESPONSE", 503, "Google returned an incomplete schedule.");
      page = body.nextPageToken;
    } while (page);
    return items;
  };
  return {
    async sources(userId: string) {
      const token = await accessToken(userId);
      const calendars = await readPages(new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250&minAccessRole=reader"), token, 1000);
      const tasks = await readPages(new URL("https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100"), token, 1000);
      return { calendars: calendars.filter((item) => typeof item.id === "string").map((item) => ({ id: item.id, name: item.summaryOverride || item.summary || "Calendar", timezone: item.timeZone })),
        taskLists: tasks.filter((item) => typeof item.id === "string").map((item) => ({ id: item.id, name: item.title || "Tasks" })) };
    },
    async sync(userId: string, anchor?: string) {
      const { data: lease, error } = await admin.rpc("begin_personal_schedule_sync", { owner_id: userId });
      if (error) throw new ScheduleFailure("SCHEDULE_UNAVAILABLE", 503, "Schedule sync is unavailable. Try again.");
      if (!lease) return { syncing: true };
      const day = anchor && /^\d{4}-\d{2}-\d{2}$/.test(anchor) && Number.isFinite(Date.parse(anchor)) ? new Date(`${anchor}T12:00:00Z`) : new Date();
      const from = new Date(day); from.setUTCDate(from.getUTCDate() - 8); from.setUTCHours(0, 0, 0, 0);
      const to = new Date(day); to.setUTCDate(to.getUTCDate() + 63); to.setUTCHours(0, 0, 0, 0);
      try {
        const token = await accessToken(userId);
        const items: ScheduleRow[] = [];
        for (const resource of lease.calendarIds as string[]) {
          const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(resource)}/events`);
          url.search = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: "true", maxResults: "2500", showDeleted: "false" }).toString();
          for (const item of await readPages(url, token)) { const row = await normalizeGoogleEvent(userId, resource, item); if (row) items.push(row); }
        }
        for (const resource of lease.taskListIds as string[]) {
          const url = new URL(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(resource)}/tasks?maxResults=100&showCompleted=false&showDeleted=false&showHidden=false&showAssigned=true`);
          for (const item of await readPages(url, token)) { const row = await normalizeGoogleTask(userId, resource, item); if (row) items.push(row); }
        }
        const { data: applied, error: writeError } = await admin.rpc("finish_personal_schedule_sync", { owner_id: userId, sync_token: lease.token,
          window_start: from.toISOString(), window_end: to.toISOString(), items });
        if (writeError) throw new ScheduleFailure("SCHEDULE_UNAVAILABLE", 503, "Your schedule could not be saved. Try again.");
        return { success: applied === true };
      } catch (failure) {
        await admin.rpc("finish_personal_schedule_sync", { owner_id: userId, sync_token: lease.token, window_start: from.toISOString(), window_end: to.toISOString(), items: [],
          error_code: failure instanceof ScheduleFailure ? failure.code : "GOOGLE_SCHEDULE_UNAVAILABLE" });
        throw failure;
      }
    },
  };
}
