import { feedbackSchema, FEEDBACK_SUCCESS } from "./feedback-schema.ts";
import { cors, json, readSmallJson } from "./http.ts";

export type SubmissionDependencies = {
  authenticate: (authorization: string) => Promise<boolean>;
  save: (
    authorization: string,
    input: ReturnType<typeof feedbackSchema.parse>,
  ) => Promise<{ id: string | null; code?: string }>;
  notify: (id: string) => Promise<void>;
  background: (task: Promise<void>) => void;
};
export function submissionHandler(deps: SubmissionDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS")
      return new Response(null, { headers: cors });
    if (request.method !== "POST")
      return json({ error: "Method not allowed." }, 405);
    const authorization = request.headers.get("Authorization") ?? "";
    try {
      if (
        !authorization.startsWith("Bearer ") ||
        !(await deps.authenticate(authorization))
      ) {
        return json({ error: "Please sign in again to send feedback." }, 401);
      }
      let body: unknown;
      try {
        body = await readSmallJson(request);
      } catch {
        return json(
          { error: "Please check your feedback and try again." },
          400,
        );
      }
      const parsed = feedbackSchema.safeParse(body);
      if (!parsed.success)
        return json(
          { error: "Please check the message, category, and optional email." },
          400,
        );
      const result = await deps.save(authorization, parsed.data);
      if (!result.id)
        return json(
          {
            error:
              result.code === "P0001"
                ? "You've sent several messages recently. Please try again in an hour."
                : "We couldn't save your feedback. Please try again.",
          },
          result.code === "P0001" ? 429 : 500,
        );
      // Saving is the success boundary. A notification outage never reverses it.
      // Even a scheduler exception must not turn a committed insert into failure.
      try {
        deps.background(
          deps
            .notify(result.id)
            .catch(() => console.error("feedback_notification_pending")),
        );
      } catch {
        console.error("feedback_notification_pending");
      }
      return json({ id: result.id, message: FEEDBACK_SUCCESS });
    } catch {
      return json(
        { error: "We couldn't save your feedback. Please try again." },
        503,
      );
    }
  };
}
