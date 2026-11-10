import * as ExpoLinking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { supabase } from "./supabase";
import { authCallbackValue } from "./oauthCallback";
import { calendarFetch } from "./calendarTransport";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

export class GoogleCalendarConnectionError extends Error {}

async function authedFetch(path: string, init?: RequestInit) {
  return calendarFetch(path, init);
}

export async function isGoogleCalendarConnected(): Promise<boolean> {
  const response = await authedFetch("/calendar/connection");
  if (!response.ok) throw new GoogleCalendarConnectionError("Could not check your Google Calendar connection. Please try again.");
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
  const original = (await supabase.auth.getSession()).data.session;
  if (!original) throw new GoogleCalendarConnectionError("Sign in before connecting Google Calendar.");
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
  const accessToken = authCallbackValue(result.url, "access_token");
  const refreshToken = authCallbackValue(result.url, "refresh_token");
  if (!code && (!accessToken || !refreshToken)) {
    throw new GoogleCalendarConnectionError("Google returned an incomplete connection. Please try again.");
  }
  const exchange = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.setSession({ access_token: accessToken!, refresh_token: refreshToken! });
  if (exchange.error) throw new GoogleCalendarConnectionError("Could not finish Google sign-in. Please try again.");
  const session = exchange.data.session;
  if (!session || session.user.id !== original.user.id) {
    await supabase.auth.setSession({ access_token: original.access_token, refresh_token: original.refresh_token });
    throw new GoogleCalendarConnectionError("Choose the Google account linked to your current SweetMate account.");
  }
  const providerRefreshToken = session?.provider_refresh_token ?? authCallbackValue(result.url, "provider_refresh_token");
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
