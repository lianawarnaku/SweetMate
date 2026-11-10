import { createClient } from "npm:@supabase/supabase-js@2.110.0";
import { CalendarFailure, createCalendarService } from "../_shared/calendar.ts";
import { json, readSmallJson } from "../_shared/http.ts";
Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" } });
  const action = new URL(request.url).pathname.split("/").at(-1);
  if (!((request.method === "GET" && action === "connection") || (request.method === "POST" && ["connect","disconnect","add-chore"].includes(action ?? "")))) return json({ error: "Not found." }, 404);
  const bearer = request.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!bearer) return json({ error: "Sign in to use Google Calendar." }, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.getUser(bearer);
  if (error || !data.user) return json({ error: "Sign in to use Google Calendar." }, 401);
  const service = createCalendarService(admin, { clientId: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID"), clientSecret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") });
  try {
    if (action === "connection") return json(await service.status(data.user.id));
    if (action === "disconnect") return json(await service.disconnect(data.user.id));
    let body;
    try { body = await readSmallJson(request); } catch { return json({ error: "Invalid request." }, 400); }
    return json(action === "connect" ? await service.connect(data.user, body) : await service.add(data.user.id, body));
  } catch (error) {
    if (error instanceof CalendarFailure) return json({ code: error.code, error: error.message }, error.status);
    console.error("calendar_request_failed");
    return json({ code: "GOOGLE_UNAVAILABLE", error: "Google Calendar is temporarily unavailable. Please try again." }, 503);
  }
});
