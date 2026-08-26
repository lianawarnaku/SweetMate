import { GoogleCalendarError } from "./googleCalendar";
import { supabaseAdmin } from "./supabaseAdmin";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
// Refresh a little before actual expiry so a request never races the token
// going stale mid-flight.
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

type ConnectionRow = {
  user_id: string;
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
};

function requiredClientConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new GoogleCalendarError(
      "GOOGLE_NOT_CONFIGURED",
      503,
      "Google Calendar is not configured for this server. Ask an administrator to connect it.",
      "Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET",
    );
  }
  return { clientId, clientSecret };
}

async function responseDetail(response: Response): Promise<string> {
  const raw = await response.text();
  if (!raw) return response.statusText || "No response body";
  try {
    const parsed = JSON.parse(raw) as {
      error?: string | { message?: string; status?: string };
      error_description?: string;
    };
    const error =
      typeof parsed.error === "string"
        ? parsed.error
        : parsed.error?.message || parsed.error?.status;
    return [error, parsed.error_description].filter(Boolean).join(": ") || raw.slice(0, 500);
  } catch {
    return raw.slice(0, 500);
  }
}

/** Stores or replaces a user's Google Calendar refresh token. */
export async function storeGoogleCalendarConnection(
  userId: string,
  refreshToken: string,
  scope?: string,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("google_calendar_connections")
    .upsert({
      user_id: userId,
      refresh_token: refreshToken,
      access_token: null,
      access_token_expires_at: null,
      scope: scope ?? null,
      updated_at: new Date().toISOString(),
    });
  if (error) {
    throw new GoogleCalendarError(
      "GOOGLE_CALENDAR_ERROR",
      503,
      "SweetMate could not save your Google Calendar connection. Please try again.",
      `Failed to store google_calendar_connections row: ${error.message}`,
    );
  }
}

/** Revokes and removes a user's Google Calendar connection. */
export async function deleteGoogleCalendarConnection(userId: string): Promise<void> {
  const { data } = await supabaseAdmin()
    .from("google_calendar_connections")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (data?.refresh_token) {
    // Best-effort revoke; the row is deleted below regardless of whether
    // Google's revoke call succeeds.
    await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(data.refresh_token)}`, {
      method: "POST",
    }).catch(() => undefined);
  }
  const { error } = await supabaseAdmin()
    .from("google_calendar_connections")
    .delete()
    .eq("user_id", userId);
  if (error) {
    throw new GoogleCalendarError(
      "GOOGLE_CALENDAR_ERROR",
      503,
      "SweetMate could not disconnect Google Calendar. Please try again.",
      `Failed to delete google_calendar_connections row: ${error.message}`,
    );
  }
}

export async function hasGoogleCalendarConnection(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from("google_calendar_connections")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

async function refreshAccessToken(connection: ConnectionRow): Promise<string> {
  const { clientId, clientSecret } = requiredClientConfig();
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: connection.refresh_token,
        grant_type: "refresh_token",
      }),
    });
  } catch (cause) {
    throw new GoogleCalendarError(
      "GOOGLE_CALENDAR_ERROR",
      503,
      "SweetMate could not reach Google Calendar. Check the server connection and try again.",
      `Google OAuth token request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  if (!response.ok) {
    const detail = await responseDetail(response);
    throw new GoogleCalendarError(
      "GOOGLE_RECONNECT_REQUIRED",
      401,
      "Your Google Calendar connection has expired or was revoked. Please reconnect it in Settings.",
      `Google OAuth token exchange failed (${response.status}): ${detail}`,
    );
  }
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new GoogleCalendarError(
      "GOOGLE_RECONNECT_REQUIRED",
      401,
      "Google did not return a usable Calendar connection. Please reconnect it in Settings.",
      "Google OAuth token exchange succeeded without an access_token",
    );
  }
  const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();
  await supabaseAdmin()
    .from("google_calendar_connections")
    .update({ access_token: data.access_token, access_token_expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq("user_id", connection.user_id);
  return data.access_token;
}

async function getUserAccessToken(userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .from("google_calendar_connections")
    .select("user_id, refresh_token, access_token, access_token_expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new GoogleCalendarError(
      "GOOGLE_CALENDAR_ERROR",
      503,
      "SweetMate could not check your Google Calendar connection. Please try again.",
      `Failed to read google_calendar_connections row: ${error.message}`,
    );
  }
  if (!data) {
    throw new GoogleCalendarError(
      "GOOGLE_RECONNECT_REQUIRED",
      401,
      "Connect Google Calendar in Settings before adding chores to it.",
      `No google_calendar_connections row for user ${userId}`,
    );
  }
  const connection = data as ConnectionRow;
  const expiresAt = connection.access_token_expires_at
    ? new Date(connection.access_token_expires_at).getTime()
    : 0;
  if (connection.access_token && expiresAt - EXPIRY_SAFETY_MARGIN_MS > Date.now()) {
    return connection.access_token;
  }
  return refreshAccessToken(connection);
}

/** Makes an authenticated Google Calendar API request using this user's own connection. */
export async function userCalendarRequest(
  userId: string,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const token = await getUserAccessToken(userId);
  let response: Response;
  try {
    response = await fetch(`${GOOGLE_CALENDAR_API}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
  } catch (cause) {
    throw new GoogleCalendarError(
      "GOOGLE_CALENDAR_ERROR",
      503,
      "SweetMate could not reach Google Calendar. Check the server connection and try again.",
      `Google Calendar API request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  if (response.ok || response.status === 409) return response;
  const detail = await responseDetail(response);
  if (response.status === 401) {
    throw new GoogleCalendarError(
      "GOOGLE_RECONNECT_REQUIRED",
      401,
      "Your Google Calendar connection has expired or was revoked. Please reconnect it in Settings.",
      `Google Calendar API returned 401: ${detail}`,
    );
  }
  if (response.status === 403) {
    throw new GoogleCalendarError(
      "GOOGLE_PERMISSION_DENIED",
      403,
      "SweetMate doesn't have permission to write to your Google Calendar. Please reconnect and grant calendar access.",
      `Google Calendar API returned 403: ${detail}`,
    );
  }
  throw new GoogleCalendarError(
    "GOOGLE_CALENDAR_ERROR",
    502,
    "Google Calendar returned an unexpected error. Please try again.",
    `Google Calendar API returned ${response.status}: ${detail}`,
  );
}
