const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

type GoogleErrorCode =
  | "GOOGLE_NOT_CONFIGURED"
  | "GOOGLE_RECONNECT_REQUIRED"
  | "GOOGLE_PERMISSION_DENIED"
  | "GOOGLE_CALENDAR_ERROR";

export class GoogleCalendarError extends Error {
  constructor(
    public readonly code: GoogleErrorCode,
    public readonly httpStatus: number,
    public readonly userMessage: string,
    public readonly diagnostic: string,
    options?: { cause?: unknown },
  ) {
    super(diagnostic, options);
    this.name = "GoogleCalendarError";
  }
}

function requiredGoogleConfig() {
  const values = {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
    calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
  };
  const missing = [
    ["GOOGLE_OAUTH_CLIENT_ID", values.clientId],
    ["GOOGLE_OAUTH_CLIENT_SECRET", values.clientSecret],
    ["GOOGLE_OAUTH_REFRESH_TOKEN", values.refreshToken],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length) {
    throw new GoogleCalendarError(
      "GOOGLE_NOT_CONFIGURED",
      503,
      "Google Calendar is not configured for this SweetMate server. Ask an administrator to connect it.",
      `Missing Google Calendar environment variables: ${missing.join(", ")}`,
    );
  }
  return values as {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    calendarId: string;
  };
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
    return (
      [error, parsed.error_description].filter(Boolean).join(": ") ||
      raw.slice(0, 500)
    );
  } catch {
    return raw.slice(0, 500);
  }
}

async function accessToken(): Promise<string> {
  const config = requiredGoogleConfig();
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
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
      "The Google Calendar connection has expired or was revoked. Ask an administrator to reconnect it.",
      `Google OAuth token exchange failed (${response.status}): ${detail}`,
    );
  }
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new GoogleCalendarError(
      "GOOGLE_RECONNECT_REQUIRED",
      401,
      "Google did not return a usable Calendar connection. Ask an administrator to reconnect it.",
      "Google OAuth token exchange succeeded without an access_token",
    );
  }
  return data.access_token;
}

export function configuredCalendarId(): string {
  return requiredGoogleConfig().calendarId;
}

export async function googleCalendarRequest(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const token = await accessToken();
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
      "The Google Calendar connection was rejected. Ask an administrator to reconnect it.",
      `Google Calendar API rejected the access token (${response.status}): ${detail}`,
    );
  }
  if (response.status === 403) {
    throw new GoogleCalendarError(
      "GOOGLE_PERMISSION_DENIED",
      403,
      "Google Calendar denied this action. Confirm the Calendar API is enabled and the connected account can edit this calendar.",
      `Google Calendar API denied the request (${response.status}): ${detail}`,
    );
  }
  throw new GoogleCalendarError(
    "GOOGLE_CALENDAR_ERROR",
    502,
    "Google Calendar could not save this event. Please try again.",
    `Google Calendar API failed (${response.status}): ${detail}`,
  );
}
