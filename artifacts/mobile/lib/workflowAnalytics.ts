export type WorkflowFailureFeature = "auth" | "household" | "chore" | "shopping" | "expense" | "calendar" | "storage" | "sync";
export type WorkflowFailureOperation = "sign_in" | "sign_up" | "auth_update" | "household_update" | "chore_update" | "shopping_update" | "expense_update" | "calendar_export" | "calendar_update" | "storage_update" | "sync" | "unknown";
export type WorkflowErrorCategory = "network" | "permission" | "validation" | "server" | "storage" | "unknown";

function workflow(action: string): { feature: WorkflowFailureFeature; operation: WorkflowFailureOperation } {
  const label = action.toLowerCase().replace(/[_-]/g, " ");
  if (/\bsign[ -]?in\b/.test(label)) return { feature: "auth", operation: "sign_in" };
  if (/\bsign[ -]?up\b/.test(label)) return { feature: "auth", operation: "sign_up" };
  if (/\b(auth|session|sign out|account|confirmation email|profile credentials)\b/.test(label)) return { feature: "auth", operation: "auth_update" };
  if (/\b(calendar|reminder)\b/.test(label)) return { feature: "calendar", operation: /\b(add|export|remove mapped|update mapped|carry reminder)\b/.test(label) ? "calendar_export" : "calendar_update" };
  if ((/\b(cache|cached|hydrate|restore|local|preferences)\b/.test(label) || /\bsave .*draft\b/.test(label)) &&
    !/\b(member task preferences?|household preferences)\b/.test(label)) return { feature: "storage", operation: "storage_update" };
  if (/\b(chore|chores|chart|plan|item difficult(?:y|ies)|task preference)\b/.test(label)) return { feature: "chore", operation: "chore_update" };
  if (/\b(shopping|shortlist|essential|essentials)\b/.test(label)) return { feature: "shopping", operation: "shopping_update" };
  if (/\b(expense|expenses|iou|repayment)\b/.test(label)) return { feature: "expense", operation: "expense_update" };
  if (/\b(household|sweet|sweets|membership|memberships|nudge|sweetmate|invite)\b/.test(label)) return { feature: "household", operation: "household_update" };
  return { feature: "sync", operation: /\b(sync|normalized|subscribe|connect|persist)\b/.test(label) ? "sync" : "unknown" };
}

function category(error: unknown, feature: WorkflowFailureFeature): WorkflowErrorCategory {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = typeof value.code === "string" ? value.code.toLowerCase() : "";
  const status = typeof value.status === "number" ? value.status :
    typeof value.statusCode === "number" ? value.statusCode : null;
  const message = typeof value.message === "string" ? value.message.toLowerCase() :
    typeof error === "string" ? error.toLowerCase() : "";
  const name = typeof value.name === "string" ? value.name : "";

  if (["invalid_credentials", "email_not_confirmed", "user_already_exists", "weak_password", "validation_failed"].includes(code)) return "validation";
  if (status === 401 || status === 403 || ["42501", "pgrst301", "pgrst302", "signup_disabled"].includes(code) || name === "NotAllowedError") return "permission";
  if (status === 408 || ["econnreset", "econnrefused", "etimedout", "enotfound", "network_error"].includes(code) ||
    /network request failed|failed to fetch|fetch failed|networkerror|network error|timed? ?out|offline|internet connection/.test(message)) return "network";
  if (status !== null && (status >= 500 || status === 429)) return "server";
  if (status === 400 || status === 422 || /^23[0-9a-z]{3}$/.test(code) || code === "22p02") return "validation";
  if (/permission denied|not authorized|unauthorized|row.level security/.test(message)) return "permission";
  if (feature === "storage") return "storage";
  return "unknown";
}

// Classify locally and return only approved enums. Never copy error messages,
// action strings, status/code values, context, URLs, or stack traces into events.
export function workflowFailureProperties(action: string, error: unknown) {
  const operation = workflow(action);
  return { ...operation, error_category: category(error, operation.feature) };
}
