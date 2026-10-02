import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "./supabase";
export {
  feedbackSchema,
  FEEDBACK_LIMIT,
  FEEDBACK_SUCCESS,
} from "../../../supabase/functions/_shared/feedback-schema";
import { feedbackSchema } from "../../../supabase/functions/_shared/feedback-schema";

export function feedbackMetadata() {
  return {
    app_version: Constants.expoConfig?.version ?? null,
    platform: (["web", "ios", "android"].includes(Platform.OS)
      ? Platform.OS
      : "other") as "web" | "ios" | "android" | "other",
  };
}
export async function sendFeedback(input: unknown) {
  const validated = feedbackSchema.parse(input);
  const { data, error } = await supabase.functions.invoke("submit-feedback", {
    body: { ...validated, contact_email: validated.contact_email ?? "" },
  });
  if (error) {
    const status =
      error.context instanceof Response ? error.context.status : null;
    throw new Error(
      status === 429
        ? "You've sent several messages recently. Please try again in an hour."
        : status === 401
          ? "Please sign in again to send feedback."
          : "We couldn't save your feedback. Check your connection and try again.",
    );
  }
  if (!data?.id)
    throw new Error(
      "We couldn't confirm your feedback was saved. Please try again.",
    );
}
