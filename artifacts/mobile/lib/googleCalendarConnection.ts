import * as ExpoLinking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { supabase } from "./supabase";
import { authCallbackValue } from "./oauthCallback";
import { apiBaseUrl } from "./externalTasks";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

export class GoogleCalendarConnectionError extends Error {}

async function authedFetch(path: string, init?: RequestInit) {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) {
    throw new GoogleCalendarConnectionError(
      "This build has no API server URL. Set EXPO_PUBLIC_API_URL and restart Expo.",
    );
  }
  const accessToken = (await supabase.auth.getSession()).data.session?.access_token;
  if (!accessToken) {
    throw new GoogleCalendarConnectionError("Sign in again and try connecting Google Calendar.");
  }
  return fetch(`${baseUrl}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...init?.headers,
    },
  });
}

export async function isGoogleCalendarConnected(): Promise<boolean> {
  const response = await authedFetch("/calendar/connection");
  if (!response.ok) return false;
  const data = (await response.json().catch(() => null)) as { connected?: boolean } | null;
  return data?.connected === true;
}

/**
 * Requests Google Calendar access for the signed-in user via Supabase's own
 * OAuth flow (the same Google provider already configured for sign-in),
 * asking for the additional calendar.events scope plus offline access so
 * Google returns a refresh token. That refresh token is sent to our own API
 * server, which stores it per-user — Google is never given our server
 * directly; the mobile app only ever talks to Supabase and to our backend.
 */
export async function connectGoogleCalendar(): Promise<void> {
  const redirectTo = ExpoLinking.createURL("auth/callback");
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      scopes: CALENDAR_SCOPE,
      queryParams: {
        access_type: "offline",
        // Force the consent screen even for a user who already granted
        // basic sign-in scopes — incremental scope grants need explicit
        // re-consent, and offline access is otherwise only issued once.
        prompt: "consent",
      },
    },
  });
  if (error) throw error;
  if (!data.url) {
    throw new GoogleCalendarConnectionError("Could not start the Google Calendar connection.");
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== "success") {
    throw new GoogleCalendarConnectionError("Google Calendar connection was cancelled.");
  }

  const oauthMessage =
    authCallbackValue(result.url, "error_description") ?? authCallbackValue(result.url, "error");
  if (oauthMessage) throw new GoogleCalendarConnectionError(oauthMessage);

  const code = authCallbackValue(result.url, "code");
  const session = code
    ? (await supabase.auth.exchangeCodeForSession(code)).data.session
    : (await supabase.auth.getSession()).data.session;

  const providerRefreshToken = session?.provider_refresh_token;
  if (!providerRefreshToken) {
    throw new GoogleCalendarConnectionError(
      "Google did not grant offline calendar access. Try again and allow the calendar permission when prompted.",
    );
  }

  const response = await authedFetch("/calendar/connect", {
    method: "POST",
    body: JSON.stringify({ refreshToken: providerRefreshToken, scope: CALENDAR_SCOPE }),
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new GoogleCalendarConnectionError(result?.error ?? "Could not save your Google Calendar connection.");
  }
}

export async function disconnectGoogleCalendar(): Promise<void> {
  const response = await authedFetch("/calendar/disconnect", { method: "POST" });
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new GoogleCalendarConnectionError(result?.error ?? "Could not disconnect Google Calendar.");
  }
}
