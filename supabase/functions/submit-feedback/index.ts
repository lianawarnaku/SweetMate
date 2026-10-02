import { createClient } from "@supabase/supabase-js";
import { submissionHandler } from "../_shared/submission.ts";
import { notifyPending } from "../_shared/notifications.ts";

declare const EdgeRuntime: { waitUntil: (task: Promise<void>) => void };
const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const auth = createClient(url, anonKey, options);
const admin = createClient(
  url,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  options,
);
Deno.serve(
  submissionHandler({
    authenticate: async (header) => {
      const { data, error } = await auth.auth.getUser(header.slice(7));
      return !error && !!data.user;
    },
    save: async (header, input) => {
      const client = createClient(url, anonKey, {
        ...options,
        global: { headers: { Authorization: header } },
      });
      const { data, error } = await client.rpc("submit_feedback", {
        p_request_id: input.request_id,
        p_category: input.category,
        p_message: input.message,
        p_contact_email: input.contact_email,
        p_app_version: input.app_version,
        p_platform: input.platform,
      });
      return { id: error ? null : data, code: error?.code };
    },
    notify: (id) =>
      notifyPending(
        admin,
        {
          apiKey: Deno.env.get("RESEND_API_KEY"),
          from: Deno.env.get("RESEND_FROM"),
          recipient: Deno.env.get("FEEDBACK_NOTIFICATION_EMAIL"),
        },
        id,
      ),
    background: (task) => EdgeRuntime.waitUntil(task),
  }),
);
