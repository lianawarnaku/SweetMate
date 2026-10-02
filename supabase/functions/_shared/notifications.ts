import type { SupabaseClient } from "@supabase/supabase-js";

export type FeedbackRow = {
  id: string;
  category: string;
  message: string;
  contact_email: string | null;
  created_at: string;
  user_id: string | null;
  app_version: string | null;
  platform: string | null;
  notification_attempts: number;
  notification_claim_id: string;
};
type NotificationConfig = {
  apiKey?: string;
  from?: string;
  recipient?: string;
};

export function notificationBody(row: FeedbackRow): string {
  return [
    "USER-PROVIDED FEEDBACK",
    `Category: ${row.category}`,
    "Message:",
    row.message,
    `Contact email (optional): ${row.contact_email ?? "Not provided"}`,
    "",
    "AUTOMATIC METADATA",
    `Submitted: ${row.created_at}`,
    `User ID: ${row.user_id ?? "Deleted account"}`,
    `App version (client-reported): ${row.app_version ?? "Not available"}`,
    `Platform (client-reported): ${row.platform ?? "Not available"}`,
    `Feedback ID: ${row.id}`,
  ].join("\n");
}

export async function deliverNotification(
  row: FeedbackRow,
  config: NotificationConfig,
  send = fetch,
): Promise<string | null> {
  if (!config.apiKey || !config.from || !config.recipient)
    return "configuration_missing";
  try {
    const response = await send("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `feedback/${row.id}`,
      },
      body: JSON.stringify({
        from: config.from,
        to: [config.recipient],
        subject: `New App Feedback: ${row.category}`,
        text: notificationBody(row),
      }),
      signal: AbortSignal.timeout(10000),
    });
    // Do not persist provider responses: they can contain addresses or credentials.
    return response.ok ? null : `provider_http_${response.status}`;
  } catch {
    return "provider_unavailable";
  }
}

export async function notifyPending(
  client: SupabaseClient,
  config: NotificationConfig,
  id: string | null = null,
) {
  const { data, error } = await client.rpc("claim_feedback_notifications", {
    p_id: id,
  });
  if (error) throw new Error("notification_claim_failed");
  for (const row of (data ?? []) as FeedbackRow[]) {
    const failure = await deliverNotification(row, config);
    const delay = Math.min(
      3600,
      60 * 2 ** Math.min(row.notification_attempts, 6),
    );
    const { error: updateError } = await client
      .from("feedback")
      .update({
        notification_sent_at: failure ? null : new Date().toISOString(),
        notification_error: failure,
        notification_next_attempt_at: new Date(
          Date.now() + delay * 1000,
        ).toISOString(),
        notification_locked_until: null,
        notification_claim_id: null,
      })
      .eq("id", row.id)
      .eq("notification_claim_id", row.notification_claim_id);
    if (updateError) throw new Error("notification_update_failed");
  }
}
