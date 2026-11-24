import { createClient } from "npm:@supabase/supabase-js@2.110.0";
import { CalendarFailure, createCalendarService } from "../_shared/calendar.ts";
import { createGoogleScheduleService, ScheduleFailure } from "../_shared/googleSchedule.ts";
import { json, readSmallJson } from "../_shared/http.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" } });
  const action = new URL(request.url).pathname.split("/").at(-1);
  if (!((request.method === "GET" && action === "sources") || (request.method === "POST" && ["sync", "worker"].includes(action ?? "")))) return json({ error: "Not found." }, 404);
  const bearer = request.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!bearer) return json({ error: "Sign in to sync your schedule." }, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const calendar = createCalendarService(admin, { clientId: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID"), clientSecret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") });
  const service = createGoogleScheduleService(admin, calendar.accessToken);
  try {
    if (action === "worker") {
      const workerToken = Deno.env.get("CALENDAR_SYNC_WORKER_TOKEN");
      if (!workerToken || bearer !== workerToken) return json({ error: "Unauthorized." }, 401);
      const { data, error } = await admin.from("personal_schedule_preferences").select("user_id").eq("enabled", true)
        .or(`synced_at.is.null,synced_at.lt.${new Date(Date.now() - 300000).toISOString()}`).order("attempted_at", { ascending: true, nullsFirst: true }).limit(20);
      if (error) throw error;
      let processed = 0;
      for (const row of data ?? []) { try { await service.sync(row.user_id); processed++; } catch { /* each lease records a non-sensitive error code */ } }
      return json({ processed });
    }
    const { data, error } = await admin.auth.getUser(bearer);
    if (error || !data.user) return json({ error: "Sign in to sync your schedule." }, 401);
    if (action === "sources") return json(await service.sources(data.user.id));
    let body: unknown;
    try { body = await readSmallJson(request); } catch { return json({ error: "Invalid sync request." }, 400); }
    const anchor = body && typeof body === "object" && "day" in body && typeof body.day === "string" ? body.day : undefined;
    return json(await service.sync(data.user.id, anchor));
  } catch (error) {
    if (error instanceof CalendarFailure || error instanceof ScheduleFailure) return json({ code: error.code, error: error.message }, error.status);
    console.error("google_schedule_request_failed");
    return json({ code: "SCHEDULE_UNAVAILABLE", error: "Your Google schedule could not sync. Try again shortly." }, 503);
  }
});
