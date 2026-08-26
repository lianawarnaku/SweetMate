import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * Server-only Supabase client using the service-role key, which bypasses
 * RLS. Never expose this key or this client to the mobile app — it exists
 * so the API server can read/write tables like google_calendar_connections
 * that intentionally have no policies granted to authenticated clients.
 */
export function supabaseAdmin(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set both as server environment variables (Settings → API → service_role key in the Supabase dashboard — never the anon key).",
    );
  }
  client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}
