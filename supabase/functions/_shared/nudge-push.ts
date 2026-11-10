import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.0";

export type Delivery = {
  id: string; nudge_id: string; device_id: string; recipient_id: string;
  expo_token: string; state: string; ticket_id: string | null; attempts: number; claim_id: string;
};
type ExpoResult = { status?: string; id?: string; details?: { error?: string } };
export function deliveryOutcome(result: ExpoResult | undefined, receipt: boolean, attempts: number) {
  if (result?.status === "ok" && (receipt || result.id)) {
    return { state: receipt ? "delivered" : "receipt", ticket_id: result.id, last_error: null, disable: false, delay: 900 };
  }
  const error = result?.details?.error ?? (receipt ? "ReceiptPending" : "ExpoUnavailable");
  const permanent = ["DeviceNotRegistered", "MessageTooBig", "InvalidCredentials", "MismatchSenderId"].includes(error);
  return {
    state: permanent || (!receipt && attempts >= 6) ? "failed" : receipt ? "receipt" : "pending",
    ticket_id: undefined, last_error: error, disable: error === "DeviceNotRegistered",
    delay: Math.min(3600, 60 * 2 ** Math.min(attempts, 6)),
  };
}

/** Durable leases prevent simultaneous workers from sending the same delivery. */
export async function processNudgePush(admin: SupabaseClient, accessToken?: string, request: typeof fetch = fetch) {
  const { data, error } = await admin.rpc("claim_nudge_push_deliveries");
  if (error) throw new Error("push_claim_failed");
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  for (const job of (data ?? []) as Delivery[]) {
    let outcome;
    try {
      const receipt = job.state === "receipt";
      const response = await request(`https://exp.host/--/api/v2/push/${receipt ? "getReceipts" : "send"}`, {
        method: "POST", headers, signal: AbortSignal.timeout(10000),
        body: JSON.stringify(receipt ? { ids: [job.ticket_id] } : [{
          to: job.expo_token, title: "A friendly nudge", body: "A Sweetmate sent you a chore reminder. Open SweetMate to see it.",
          sound: "default", channelId: "nudges", ttl: 3600,
          data: { type: "nudge", nudgeId: job.nudge_id },
        }]),
      });
      if (!response.ok) throw new Error("expo_unavailable");
      const payload = await response.json();
      const result = receipt ? payload.data?.[job.ticket_id!] : payload.data?.[0];
      outcome = deliveryOutcome(result, receipt, job.attempts);
    } catch {
      outcome = deliveryOutcome(undefined, job.state === "receipt", job.attempts);
    }
    if (outcome.disable) {
      const { error } = await admin.from("push_devices").update({ enabled: false })
        .eq("id", job.device_id).eq("expo_token", job.expo_token).eq("user_id", job.recipient_id);
      if (error) throw new Error("push_device_cleanup_failed");
    }
    const { error: updateError } = await admin.from("nudge_push_deliveries").update({
      state: outcome.state, ...(outcome.ticket_id ? { ticket_id: outcome.ticket_id } : {}),
      last_error: outcome.last_error, next_attempt_at: new Date(Date.now() + outcome.delay * 1000).toISOString(),
      locked_until: null, claim_id: null,
    }).eq("id", job.id).eq("claim_id", job.claim_id);
    if (updateError) throw new Error("push_update_failed");
  }
  return { processed: data?.length ?? 0 };
}
