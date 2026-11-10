import { supabase } from "./supabase";

/** Use the authenticated Supabase endpoint; no separate public API URL is needed. */
export async function calendarFetch(path: string, init?: RequestInit): Promise<Response> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("Sign in again before using Google Calendar.");
  const projectUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!projectUrl) throw new Error("Google Calendar is unavailable in this build.");
  return fetch(`${projectUrl}/functions/v1/calendar${path.replace(/^\/calendar/, "")}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
      ...init?.headers,
    },
  });
}
