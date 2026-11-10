import { createClient } from "npm:@supabase/supabase-js@2.110.0";
import { processNudgePush } from "../_shared/nudge-push.ts";
import { json } from "../_shared/http.ts";
Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const token = Deno.env.get("NUDGE_PUSH_WORKER_TOKEN");
  if (!token || request.headers.get("Authorization") !== `Bearer ${token}`) return json({ error: "Unauthorized." }, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try { return json(await processNudgePush(admin, Deno.env.get("EXPO_ACCESS_TOKEN"))); }
  catch { return json({ error: "Push processing failed." }, 503); }
});
