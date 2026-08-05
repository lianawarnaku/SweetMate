# Multi-household management audit

Updated August 5, 2026.

## Root cause

The server and context already supported multiple active membership rows. Settings
also rendered those rows, but its only management footer navigated to the shared
first-time setup route as “Create or join a household.” With an existing active
household, that setup component hid its create/join selector and rendered the
create wizard while refusing to create because `householdId` was already set.
Membership query errors were also converted into an empty household state, which
could incorrectly expose onboarding.

## Single-household assumption audit

- Membership loading batches every active `household_members` row for the auth
  user, then batches household metadata. It is not owner-only or active-only.
- The persisted selection is the primitive active household ID. It is validated
  against current memberships and otherwise falls back predictably.
- `currentMemberRole` is replaced from the selected membership during switching;
  the same user can therefore be owner in one household and member in another.
- `switchSweet` clears household-scoped collections, realtime readiness, member
  lists, permissions inputs, planning records, and selected shared data before
  applying a household-specific cache.
- Create and Join preserve the existing membership array. Account onboarding is
  only initialized when the user had no prior memberships.
- Leaving/deleting an active household selects a remaining membership without
  signing out or deleting unrelated memberships.
- `AuthGate` now distinguishes a membership-query error from a genuine empty
  membership list and provides a retry action.

## Human verification checklist

1. Sign in as a user belonging to Household A.
2. Open Settings → Manage Households; confirm A is listed and creation does not open.
3. Select Create Household and create Household B.
4. Reopen Manage Households and confirm A and B are present.
5. Switch A → B → A; verify chores, shopping, expenses, borrowing, and members change.
6. Confirm personal theme and account preferences remain unchanged.
7. Select Join Household and join Household C with a valid invite code.
8. Confirm A, B, and C remain listed with the correct role for each.
9. Confirm owner-only controls appear only in households where the user is owner.
10. Leave one non-owner household and confirm all others remain accessible.
11. Restart the app and confirm the most recently active valid household restores.
12. Remove the active membership from another session and confirm the app falls back safely.
13. Rapidly switch between two households and check that no prior household data flashes.
14. Temporarily interrupt networking and confirm a retry screen appears instead of creation.
15. Review diagnostics for the active household ID and role after each switch.
