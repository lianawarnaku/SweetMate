/**
 * Development-only instrumentation for the chore action pipeline (checkbox,
 * three-dot menu, edit, delete). This exists so a human tester can pull a
 * build and see *why* a control did nothing for a non-host member, without
 * an engineer having to attach a debugger. Every call is a no-op in
 * production builds and never logs tokens, chore notes, or other household
 * content — only ids, booleans, and role/action names.
 */

export type ChoreActionEvent =
  | "checkbox-tap"
  | "open-menu"
  | "complete"
  | "edit"
  | "delete";

export function logChorePermissionCheck(
  event: ChoreActionEvent,
  detail: {
    choreId: string;
    currentUserId: string | null | undefined;
    householdId: string | null | undefined;
    isActiveMember: boolean;
    isOwner: boolean;
    allowed: boolean;
  },
) {
  if (!__DEV__) return;
  console.log(
    `[chore-diagnostics] ${event}`,
    JSON.stringify({
      choreId: detail.choreId,
      hasUserId: Boolean(detail.currentUserId),
      hasHouseholdId: Boolean(detail.householdId),
      isActiveMember: detail.isActiveMember,
      isOwner: detail.isOwner,
      allowed: detail.allowed,
    }),
  );
}
