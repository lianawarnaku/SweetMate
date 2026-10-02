import { createClient } from "@supabase/supabase-js";
import { notifyPending } from "../_shared/notifications.ts";
import { json } from "../_shared/http.ts";

Deno.serve(async (request) => {
  if (request.method !== "POST")
    return json({ error: "Method not allowed." }, 405);
  const secret = Deno.env.get("FEEDBACK_WORKER_TOKEN");
  if (!secret || request.headers.get("Authorization") !== `Bearer ${secret}`)
    return json({ error: "Unauthorized." }, 401);
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  try {
    await notifyPending(admin, {
      apiKey: Deno.env.get("RESEND_API_KEY"),
      from: Deno.env.get("RESEND_FROM"),
      recipient: Deno.env.get("FEEDBACK_NOTIFICATION_EMAIL"),
    });
    return json({ ok: true });
  } catch {
    return json({ error: "Notification processing failed." }, 503);
  }
});
