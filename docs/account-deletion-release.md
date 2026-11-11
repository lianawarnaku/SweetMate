# Account deletion release gate

Implementation: authenticated `delete-account` Edge Function, migration
`202611100004_account_deletion.sql`, mobile deletion helper and Settings flow.
No real account was deleted during development.

## Behavior

- Authenticate the Supabase bearer against Auth; never accept a target user ID.
- Apple-linked accounts confirm the same Apple account. Validate the provider
  refresh token directly with Apple, bind its returned identity to the current
  account, and revoke it before database deletion. Provider failure stops deletion.
- Revoke a stored Google Calendar refresh token before deleting its connection.
- Delete Auth identity/sessions and cascading private records, memberships,
  preferences, device registrations, calendar credentials, feedback and nudges.
- Transfer ownership to another active member, preferring an existing owner and
  then the earliest membership. Delete an owned Sweet if no active members remain.
- Preserve shared financial/borrowing facts under random, household-specific
  “Deleted member” IDs. Strip old profiles from shared snapshots; remove departed
  users from chore rotations and return unfinished assignments for reassignment.
- Prevent stale clients from restoring the old profile/ID on later shared writes.
- Remove this user's local app caches and disconnect the local session. Exported
  Google events / Apple Reminders are user-owned copies and remain in those apps.

## Deployment order

1. In Supabase Edge Function Secrets, owner saves `APPLE_OAUTH_CLIENT_ID` as
   `com.homieapplication.homie.web` and `APPLE_OAUTH_CLIENT_SECRET` as the current
   signed JWT from Auth → Apple provider. Never add these to Expo/public variables.
   The JWT expires: rotate both provider and Edge copies together before expiry.
2. Deploy `delete-account` (verify_jwt=false in config; handler itself validates
   the bearer with Auth). Check unauthenticated/invalid requests return 401.
3. Apply the migration transaction. It changes no accounts by itself. The old
   direct SQL deletion RPC deliberately requires an updated app, so old builds
   cannot bypass Apple revocation. Do not restore that old RPC as a workaround.
4. Build and deliver a new native build; build 46 does not contain this fix.
5. Test a user-approved disposable Apple account on a physical iPhone. Confirm
   cancel/wrong-account paths preserve it; successful deletion removes it from
   Auth, its private records and Apple authorization. Rejoining creates a fresh
   account and does not recover anonymous historical ownership.
6. Verify email/Google deletion, owner transfer, sole-member cleanup, lost
   connectivity, and access with the old session. Never use the owner's real
   account or a real roommate's account as the disposable fixture.
7. Publish the matching privacy/support pages and replace the App Store build.
   Obtain owner approval before App Review submission / public release.

## Optional analytics and diagnostics

`vendor_erasure_requests` is a private support queue, NOT proof of vendor erasure.
It stores the submitting device's random analytics ID without a login/name/email.
An authorized operator must locate that ID in PostHog, delete the person AND
associated events using the vendor's supported deletion workflow, and only then
set `completed_at`. Do not delete another person's vendor data based solely on an
unverified client-supplied ID. Historical IDs from other devices are not centrally
mapped and may need additional user information. No privileged PostHog deletion
credential is configured by this change. Sentry is currently not configured.
Logs/backups follow provider retention; free-text shared notes may need separate
privacy review. Do not advertise complete vendor erasure or immediate backup
purging before that process is verified.

## Verification

- `pnpm run typecheck`
- `pnpm --filter @workspace/mobile run test`
- `node scripts/accounts/test-deletion-runtime.mjs`
- `node scripts/accounts/test-deletion-client.mjs`
- `node scripts/accounts/test-deletion-database.mjs <PGlite module path>`
- `pnpm dlx deno check --config supabase/functions/deno.json supabase/functions/delete-account/index.ts`
- Expo web export to `/tmp/sweetmate-account-deletion-web`

Database tests use real expense, payment, chore, chart and borrowing migrations
in a disposable PostgreSQL WASM database. They check service-only authorization,
provider-failure ordering, owner/payer deletion, unchanged amounts, rollback,
idempotency, last-member cleanup, alias isolation, and stale-profile suppression.
Physical Apple revocation and the new native build remain separate release gates.

## Deployment status — November 11, 2026

The Edge Function and migration are deployed to project `eqnogaftebuqfwwelbdx`.
Migration history records `202611100004` as applied. An unauthenticated live
request returned 401. Post-deployment checks confirmed unchanged account,
household, membership and expense counts and unchanged total expense cents.
No alias rows were created and no live account was deleted. The authenticated
role cannot execute finalization; service_role can. Supabase Storage currently
contains zero objects, and the app does not upload avatar files to Storage.

The two Apple Edge Function secrets were still absent at the last CLI check.
Their entry has been handed to the owner. Native build and real-device Apple
revocation are not yet verified. The support/privacy source is prepared locally;
publishing those pages remains part of the wider App Store release task.
