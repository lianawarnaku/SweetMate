# Borrowing saves and Other owners — November 26, 2026

The owner reported that in TestFlight 1.0.0 (54), selecting themselves in Borrowing
left the form open and Save appeared to do nothing. They then requested an Other
option for the item owner.

## Causes and changes

- Borrower state captured the initial placeholder user before authentication and
  household loading. Opening Add did not refresh it. New drafts now start with the
  current signed-in member, current dates, and a fresh draft ID every time.
- Add/edit reported success before persistence was acknowledged. A thrown error
  could leave the editor's pending lock set. Saves now await the shared/private
  Supabase row acknowledgement, retain the form on failure, show an inline error,
  and release the lock in finally. Retry reuses the draft UUID to avoid duplicates.
  The request has a 20-second timeout, double taps are ignored, and a household
  change prevents the response from being published into the new household.
- The sheet now has a bounded keyboard-aware container, a scrolling form, and a
  fixed Save footer. Save uses semantic action/foreground colors. Owner and borrower
  controls have labels, selected radio states, and a 44-point minimum height.
- The July self-borrowing allowance was undone when an August migration replaced
  the legacy borrowing validator. The new migration fixes the final deployed
  validator, including its service-only account-deletion maintenance guard.

## Other owner behavior

Owner offers household members and **Other**. Other reveals an owner-name field
(required, trimmed, 1–100 characters). The borrower remains an active household
member. Both shared and private records support outside owners and later edits.

The app stores the source as borrowedFrom=other plus externalOwnerName. Shared
rows store NULL in the UUID borrowed_from column, with a constraint requiring the
explicit Other source and name. Record creator/owner IDs remain real authenticated
users. No fabricated account or household member is created. For shared outside
items, the borrower requests return and the member who logged the record can
confirm; the outside person does not need an app account.

## Verification

- Actual BorrowScreen fixture reproduced the stale placeholder borrower before the
  fix, then passed self-save after account hydration, pending acknowledgement,
  duplicate taps, thrown-save recovery with the same draft ID, and named Other.
- Persistence/context regression tests exercise shared/private payloads, real
  creator ownership, acknowledgement scope, denied responses, timeout cleanup,
  idempotency, and rejection of nonmember borrowers.
- All 59 migrations were replayed in PGlite before running the SQL regression.
  It checks self-borrowing after the entire migration chain; named/unnamed Other;
  legacy and normalized records; private/outsider isolation; and creator account
  deletion without losing the shared record for the remaining roommate.
- Live browser checks used only disposable Audit Avery/Blake accounts in the local
  Interaction Audit Home: shared self-borrowing; shared Other reaching the other
  member; borrower return request and creator confirmation; private Other hidden
  from the peer; owner-name edit; and persistence after reloading both sessions.
- Workspace typecheck, full mobile test suite, local web and native Hermes exports,
  and git diff --check passed. These exports are compilation checks, not a signed
  native app. Physical-iPhone keyboard/VoiceOver testing remains outstanding.
- Browser viewport override did not take effect (observed desktop viewport), so
  this check does not establish iPhone-width layout or native keyboard behavior.

Evidence/logs are under /tmp/sweetmate-borrowing-fix. Private database backups are
outside Git, permission-restricted, and are not included in this report.

## Backend and delivery

Migration 202611260003_borrowing_owner_sources.sql was applied to the local QA
backend and the existing linked production project. Dry run showed only that
migration pending. Production schema readback confirmed the new owner constraint,
self-borrowing allowance, and preserved account-deletion branch. Comparison of
before/after public data exports found identical records across all 29 populated
tables. RLS policies, grants, accounts, and household memberships are unchanged.

The CLI emitted a migrations-catalog cache certificate warning after applying the
migration; the successful schema readback independently confirmed application.

Prepared on canonical main and refreshed in the persona previews. Build 54's
installed UI is unchanged. No EAS build, TestFlight submission or distribution was
started; the owner must request the next native release to deliver the UI changes.
