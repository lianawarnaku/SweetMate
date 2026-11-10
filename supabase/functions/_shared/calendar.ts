import type { SupabaseClient, User } from "npm:@supabase/supabase-js@2.110.0";

const API = "https://www.googleapis.com/calendar/v3";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";
export class CalendarFailure extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}
type Configuration = { clientId?: string; clientSecret?: string };
type Token = { access_token: string; expires_in?: number; scope?: string };
export function validateCalendarInput(value: unknown) {
  const input = value as Record<string, unknown> | null;
  if (!input || typeof input.choreId !== "string" || !input.choreId.trim() || input.choreId.length > 128 ||
    typeof input.title !== "string" || !input.title.trim() || input.title.length > 200 ||
    typeof input.dueDate !== "string") throw new CalendarFailure("INVALID_CHORE", 400, "A chore ID, title, and valid due date are required.");
  const date = input.dueDate.slice(0, 10);
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
    throw new CalendarFailure("INVALID_DUE_DATE", 400, "This chore needs a valid due date.");
  const optional = (key: string, limit: number) => typeof input[key] === "string" ? (input[key] as string).slice(0, limit) : "";
  return { choreId: input.choreId, title: input.title.trim(), date,
    description: optional("description", 2000), assignee: optional("assignee", 100), household: optional("household", 100), category: optional("category", 50) };
}
export async function calendarEvent(value: unknown) {
  const input = validateCalendarInput(value);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`sweetmate:chore-occurrence:${input.choreId}`));
  const end = new Date(`${input.date}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 1);
  return {
    id: Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join(""),
    summary: `🏠 ${input.title}`,
    description: ["Added from SweetMate", input.assignee && `Assigned to: ${input.assignee}`, input.household && `Sweet: ${input.household}`, input.category && `Category: ${input.category}`, input.description].filter(Boolean).join("\n"),
    start: { date: input.date }, end: { date: end.toISOString().slice(0, 10) },
    extendedProperties: { private: { sweetmateChoreOccurrenceId: input.choreId } },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 480 }] },
  };
}
export function createCalendarService(admin: SupabaseClient, config: Configuration, request: typeof fetch = fetch) {
  const call = (url: string, init: RequestInit) => request(url, { ...init, signal: AbortSignal.timeout(15000) });
  const refresh = async (refreshToken: string): Promise<Token> => {
    if (!config.clientId || !config.clientSecret) throw new CalendarFailure("GOOGLE_NOT_CONFIGURED", 503, "Google Calendar is not configured yet. Please try again later.");
    const response = await call("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }) });
    if (!response.ok) {
      if (response.status >= 500 || response.status === 429) throw new CalendarFailure("GOOGLE_UNAVAILABLE", 503, "Google Calendar is temporarily unavailable. Please try again.");
      throw new CalendarFailure("GOOGLE_RECONNECT_REQUIRED", 401, "Reconnect Google Calendar in Settings and allow calendar access.");
    }
    const token = await response.json() as Token;
    if (!token.access_token) throw new CalendarFailure("GOOGLE_RECONNECT_REQUIRED", 401, "Google did not return calendar access. Please reconnect.");
    return token;
  };
  const saveToken = async (userId: string, token: Token) => {
    const { error } = await admin.from("google_calendar_connections").update({ access_token: token.access_token,
      access_token_expires_at: new Date(Date.now() + (token.expires_in ?? 3600) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("user_id", userId);
    if (error) throw new CalendarFailure("CONNECTION_UNAVAILABLE", 503, "Could not update your Calendar connection. Please try again.");
  };
  const connection = async (userId: string) => {
    const { data, error } = await admin.from("google_calendar_connections").select("refresh_token,access_token,access_token_expires_at").eq("user_id", userId).maybeSingle();
    if (error) throw new CalendarFailure("CONNECTION_UNAVAILABLE", 503, "Could not check your Calendar connection. Please try again.");
    return data;
  };
  const access = async (userId: string) => {
    const row = await connection(userId);
    if (!row) throw new CalendarFailure("GOOGLE_RECONNECT_REQUIRED", 401, "Connect Google Calendar in Settings before adding chores.");
    if (row.access_token && Date.parse(row.access_token_expires_at ?? "") > Date.now() + 60000) return row.access_token as string;
    const token = await refresh(row.refresh_token); await saveToken(userId, token); return token.access_token;
  };
  return {
    async connect(user: User, value: unknown) {
      const input = value as { refreshToken?: unknown } | null;
      if (typeof input?.refreshToken !== "string" || !input.refreshToken || input.refreshToken.length > 4096)
        throw new CalendarFailure("INVALID_CONNECTION", 400, "Google did not grant offline access. Please reconnect.");
      const token = await refresh(input.refreshToken);
      if (!token.scope?.split(" ").some(scope => scope === SCOPE || scope === "https://www.googleapis.com/auth/calendar"))
        throw new CalendarFailure("GOOGLE_PERMISSION_DENIED", 403, "Reconnect Google Calendar and allow calendar event access.");
      const identityResponse = await call("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` } });
      if (!identityResponse.ok) throw new CalendarFailure("GOOGLE_RECONNECT_REQUIRED", 401, "Could not confirm your Google account. Please reconnect.");
      const identity = await identityResponse.json();
      if (typeof identity.sub !== "string" || !user.identities?.some(i => i.provider === "google" && (i.identity_data?.sub === identity.sub || i.id === identity.sub)))
        throw new CalendarFailure("GOOGLE_ACCOUNT_MISMATCH", 403, "Choose the Google account linked to your current SweetMate account.");
      const { error } = await admin.from("google_calendar_connections").upsert({ user_id: user.id, refresh_token: input.refreshToken,
        scope: token.scope, access_token: token.access_token, access_token_expires_at: new Date(Date.now() + (token.expires_in ?? 3600) * 1000).toISOString(), updated_at: new Date().toISOString() });
      if (error) throw new CalendarFailure("CONNECTION_UNAVAILABLE", 503, "Could not save your Calendar connection. Please try again.");
      return { success: true };
    },
    async status(userId: string) {
      if (!await connection(userId)) return { connected: false };
      try { await access(userId); return { connected: true }; }
      catch (error) { if (error instanceof CalendarFailure && error.code === "GOOGLE_RECONNECT_REQUIRED") return { connected: false, reconnectRequired: true }; throw error; }
    },
    async disconnect(userId: string) {
      const row = await connection(userId);
      if (row) await call("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: row.refresh_token }) }).catch(() => undefined);
      const { error } = await admin.from("google_calendar_connections").delete().eq("user_id", userId);
      if (error) throw new CalendarFailure("CONNECTION_UNAVAILABLE", 503, "Could not disconnect Calendar. Please try again.");
      return { success: true };
    },
    async add(userId: string, value: unknown) {
      const event = await calendarEvent(value);
      const response = await call(`${API}/calendars/primary/events`, { method: "POST", headers: { Authorization: `Bearer ${await access(userId)}`, "Content-Type": "application/json" }, body: JSON.stringify(event) });
      if (response.status === 409) return { success: true, alreadyAdded: true, eventId: event.id };
      if (response.status === 401) throw new CalendarFailure("GOOGLE_RECONNECT_REQUIRED", 401, "Reconnect Google Calendar in Settings.");
      if (response.status === 403) throw new CalendarFailure("GOOGLE_PERMISSION_DENIED", 403, "Allow calendar access and confirm the Google Calendar API is enabled.");
      if (!response.ok) throw new CalendarFailure("GOOGLE_UNAVAILABLE", 503, "Google Calendar could not save this event. Please try again.");
      const created = await response.json();
      return { success: true, alreadyAdded: false, eventId: created.id, link: created.htmlLink };
    },
  };
}
