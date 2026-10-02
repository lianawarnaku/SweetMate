import { feedbackSchema, FEEDBACK_SUCCESS } from "./feedback-schema.ts";
import { submissionHandler } from "./submission.ts";
import {
  deliverNotification,
  notificationBody,
  notifyPending,
  type FeedbackRow,
} from "./notifications.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}
const input = {
  request_id: "7b25d8c3-4601-466c-aecd-c6e4439df57f",
  category: "suggestion",
  message: "A helpful suggestion",
  contact_email: "",
  app_version: "1.0",
  platform: "web",
};
Deno.test(
  "validation: categories, whitespace, size, email, and privileged fields",
  () => {
    assert(feedbackSchema.parse(input).contact_email === null);
    for (const patch of [
      { message: "   \n\t" },
      { message: "x".repeat(1501) },
      { category: "admin" },
      { contact_email: "bad@" },
      { user_id: "another-user" },
      { status: "closed" },
      { notification_sent_at: "today" },
      { created_at: "yesterday" },
    ]) {
      assert(
        !feedbackSchema.safeParse({ ...input, ...patch }).success,
        JSON.stringify(patch),
      );
    }
    assert(
      feedbackSchema.safeParse({
        ...input,
        message: "x".repeat(1500),
        contact_email: " person@example.com ",
      }).success,
    );
  },
);
function post(body: unknown = input, authenticated = true) {
  return new Request("https://example.com/submit-feedback", {
    method: "POST",
    headers: authenticated ? { Authorization: "Bearer user-token" } : {},
    body: JSON.stringify(body),
  });
}
Deno.test(
  "save succeeds despite email outage; notification begins only after save",
  async () => {
    const events: string[] = [];
    const tasks: Promise<void>[] = [];
    const handler = submissionHandler({
      authenticate: async () => true,
      save: async () => {
        events.push("saved");
        return { id: "receipt" };
      },
      notify: async () => {
        events.push("notify");
        throw new Error("outage");
      },
      background: (task) => {
        tasks.push(task);
      },
    });
    const response = await handler(post());
    assert(response.status === 200);
    assert((await response.json()).message === FEEDBACK_SUCCESS);
    await Promise.all(tasks);
    assert(events.join(",") === "saved,notify");
  },
);
Deno.test(
  "unauthenticated, invalid, throttled and failed saves never notify",
  async () => {
    let saved = 0;
    let notifications = 0;
    const handler = submissionHandler({
      authenticate: async () => true,
      save: async () => {
        saved++;
        return { id: null, code: "P0001" };
      },
      notify: async () => {
        notifications++;
      },
      background: () => {},
    });
    assert((await handler(post(input, false))).status === 401);
    assert(
      (await handler(post({ ...input, user_id: "spoof" }))).status === 400,
    );
    assert(saved === 0);
    assert((await handler(post())).status === 429);
    assert(notifications === 0);
    const denied = submissionHandler({
      authenticate: async () => false,
      save: async () => {
        throw Error("should not save");
      },
      notify: async () => {},
      background: () => {},
    });
    assert((await denied(post())).status === 401);
  },
);
const row: FeedbackRow = {
  id: "receipt",
  category: "bug",
  message: "My text <script>",
  contact_email: null,
  created_at: "2026-10-02T12:00:00Z",
  user_id: "auth-id",
  app_version: "1.0",
  platform: "web",
  notification_attempts: 1,
  notification_claim_id: "claim",
};
Deno.test(
  "notification is private plain text, idempotent, and records safe failures",
  async () => {
    let body: Record<string, unknown> = {};
    const success = await deliverNotification(
      row,
      {
        apiKey: "server-secret",
        from: "team@example.com",
        recipient: "private@example.com",
      },
      async (_url, options) => {
        assert(
          new Headers(options?.headers).get("Idempotency-Key") ===
            "feedback/receipt",
        );
        body = JSON.parse(String(options?.body));
        return new Response("{}", { status: 200 });
      },
    );
    assert(success === null);
    assert(!("html" in body));
    assert(String(body.text).includes("USER-PROVIDED FEEDBACK"));
    assert(notificationBody(row).includes("AUTOMATIC METADATA"));
    assert((await deliverNotification(row, {})) === "configuration_missing");
    assert(
      (await deliverNotification(
        row,
        { apiKey: "key", from: "from", recipient: "to" },
        async () => new Response("private provider detail", { status: 503 }),
      )) === "provider_http_503",
    );
  },
);
Deno.test(
  "worker retains saved feedback and releases lease for retry on provider failure",
  async () => {
    let updated: Record<string, unknown> = {};
    const db = {
      rpc: async () => ({ data: [row], error: null }),
      from: (table: string) => {
        assert(table === "feedback");
        return {
          update: (value: Record<string, unknown>) => {
            updated = value;
            return { eq: () => ({ eq: async () => ({ error: null }) }) };
          },
        };
      },
    } as unknown as SupabaseClient;
    await notifyPending(db, {});
    assert(updated.notification_sent_at === null);
    assert(updated.notification_error === "configuration_missing");
    assert(updated.notification_locked_until === null);
    assert(
      new Date(String(updated.notification_next_attempt_at)).getTime() >
        Date.now(),
    );
  },
);
Deno.test(
  "scheduler failure does not turn a saved submission into an error",
  async () => {
    const handler = submissionHandler({
      authenticate: async () => true,
      save: async () => ({ id: "receipt" }),
      notify: async () => {},
      background: () => {
        throw Error("scheduler unavailable");
      },
    });
    assert((await handler(post())).status === 200);
  },
);
