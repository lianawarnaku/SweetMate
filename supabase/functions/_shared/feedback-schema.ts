import { z } from "zod/v4";

export const FEEDBACK_LIMIT = 1500;
export const FEEDBACK_SUCCESS = "Your suggestion has been sent to the team.";
export const feedbackSchema = z
  .object({
    request_id: z.uuid(),
    category: z.enum(["suggestion", "bug", "other"]),
    message: z
      .string()
      .max(FEEDBACK_LIMIT, "Keep your message to 1,500 characters or fewer.")
      .trim()
      .min(1, "Please enter your feedback.")
      .refine(
        (value) => !value.includes("\u0000"),
        "Please remove unsupported characters.",
      ),
    contact_email: z
      .string()
      .trim()
      .max(254)
      .refine(
        (value) => value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
        "Enter a valid email address or leave it blank.",
      )
      .transform((value) => value || null),
    app_version: z.string().trim().max(64).nullable(),
    platform: z.enum(["web", "ios", "android", "other"]),
  })
  .strict();
export type FeedbackSubmission = z.output<typeof feedbackSchema>;
