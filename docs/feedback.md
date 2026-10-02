# Suggestions & Feedback

Settings now includes a themed feedback sheet for authenticated users. The form
supports Suggestion, Bug, and Other, a required message of up to 1,500 characters,
and an optional, removable contact email prefilled from Supabase Auth. Success
reads: “Your suggestion has been sent to the team.” The receipt is shown until
Done; the next form starts fresh. No feedback text or contact email is sent to
analytics.

## Deployment status (2026-10-02)

Implemented in `Downloads/Homie2-main`, on `main` tracking the GitHub repository
`lianawarnaku/homiev2`. This is the canonical checkout for all work and previews.
The configured Supabase
project is SweetMate (`eqnogaftebuqfwwelbdx`). All three feedback migrations and
both Edge Functions are deployed. The recipient and private retry-worker token
are configured server-side, including the matching Supabase Vault values. The
Cron job `feedback-notifications` is active every five minutes.

**Email delivery still requires `RESEND_API_KEY` and `RESEND_FROM`.** Configure
these in Supabase Dashboard → Edge Functions → Secrets. Use your Resend API key
and a sender permitted by your Resend account (normally on a verified domain).
The integration reuses the repository's existing Resend provider; it does not
use the existing general-purpose `/api/email/send` relay. Existing Express
server environment variables do not automatically propagate to Edge Functions.

Feedback already saves without these secrets. Its notification remains queued
and is retried after configuration. `notification_sent_at` means Resend accepted
the message; it does not confirm inbox delivery. No real delivery was verified
because the provider secrets are not configured.

The normal migration dry run found remote historical migrations missing from
the original homiev1 checkout during initial deployment. Only the new feedback migrations were applied using
transactional SQL via the Supabase CLI Management API, with their SQL recorded
in `supabase_migrations.schema_migrations`. Existing migration history was not
repaired, reverted, or changed. The canonical homiev2 checkout includes those historical files.

## Data, permissions, and flow

The exact table is **`public.feedback`**. Review submissions in
[Supabase Table Editor](https://supabase.com/dashboard/project/eqnogaftebuqfwwelbdx/editor)
→ `public` → `feedback`. Dashboard administrators can update `status` to `new`,
`reviewed`, or `closed`. There is no new admin application.

1. The client validates with the shared Zod schema and calls `submit-feedback`
   through the existing singleton Supabase client. A synchronous lock prevents
   repeated clicks; a UUID request key is retained across retries of the same
   draft. Only category, message, optional contact email, app version, platform,
   and request key are sent.
2. The Edge Function validates the session with Auth `getUser`, caps the request
   body, validates again, then calls the `submit_feedback` database RPC using the
   user's bearer token. Unknown fields (including a client-supplied user ID or
   workflow status) are rejected.
3. The RPC derives `auth.uid()`, inserts the row, and returns a receipt without
   granting table reads. A per-user transactional lock, unique request key, and
   five-per-hour limit protect both the RPC and direct inserts. Reusing a key
   with changed content is rejected. Retrying the same key returns its receipt,
   even when the hourly quota has been reached.
4. The saved row is also the durable email queue. The Edge Function starts a
   background notification and returns success once saving is complete.
5. The worker claims rows with a five-minute lease, sends plain text through
   Resend, and records acceptance or a sanitized failure code. Failed requests
   use capped exponential backoff. Cron retries pending rows every five minutes;
   leases expire if a worker crashes. A claim token prevents stale workers from
   updating a newer worker's lease.

RLS is enabled. Authenticated users have INSERT permissions only on the six
nonprivileged submission columns, with `user_id = auth.uid()` enforced by policy
and trigger. They cannot SELECT, UPDATE, or DELETE feedback, including their own
rows. Anonymous callers cannot submit. The only authenticated RPC exposes a
narrow insert operation; notification claiming is service-role only. Server
fields, including identity, timestamps, workflow state, and notification state,
are not writable by application users. Auth account deletion nulls `user_id`
and retains the feedback record.

The private recipient is read exclusively from `FEEDBACK_NOTIFICATION_EMAIL`.
It is not in the frontend source, public Expo variables, API success/error
responses, or generated web bundle. Service-role and Resend credentials are
server-only. The notification separates user-entered content from automatic
metadata and never uses user text as HTML or as an email header.

Resend's idempotency key is `feedback/<row UUID>`. Resend retains idempotency keys
for a limited period (24 hours); an unusually long outage between provider
acceptance and database acknowledgement can cause a duplicate notification.
The stored feedback remains unique. Each worker claims at most ten records.

## Secrets and configuration

| Location                      | Name                                                             | Purpose                                       |
| ----------------------------- | ---------------------------------------------------------------- | --------------------------------------------- |
| Edge Function secrets         | `RESEND_API_KEY`                                                 | Required next: transactional email credential |
| Edge Function secrets         | `RESEND_FROM`                                                    | Required next: authorized sender              |
| Edge Function secrets         | `FEEDBACK_NOTIFICATION_EMAIL`                                    | Configured private recipient                  |
| Edge Function secrets         | `FEEDBACK_WORKER_TOKEN`                                          | Configured random worker authentication token |
| Supabase Vault                | `feedback_project_url`                                           | Configured project URL for Cron               |
| Supabase Vault                | `feedback_worker_token`                                          | Same configured worker token                  |
| Supabase-managed Edge secrets | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Runtime Supabase access                       |

Never put these secrets in `EXPO_PUBLIC_*` variables. To deploy into a different
project, apply the migrations, set the Edge secrets, create the two Vault secrets
with `vault.create_secret`, and deploy:

```sh
pnpm exec supabase functions deploy submit-feedback notify-feedback \
  --project-ref YOUR_PROJECT_REF --use-api --import-map supabase/functions/deno.json
```

`verify_jwt = false` is deliberate: the submission handler verifies the current
user with Supabase Auth, while the worker requires its dedicated bearer secret.
The worker does not accept a user's JWT as authorization.

The retry mechanism follows [Supabase's scheduling guidance](https://supabase.com/docs/guides/functions/schedule-functions),
uses [background tasks](https://supabase.com/docs/guides/functions/background-tasks),
and uses [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Files

- `artifacts/mobile/app/settings.tsx`: entry point in existing Settings.
- `artifacts/mobile/components/FeedbackSection.tsx`: form, validation display,
  request lock, draft retry key, accessibility, success state.
- `artifacts/mobile/lib/feedback.ts`: existing Supabase client integration.
- `supabase/functions/_shared/`: shared Zod schema, request handling,
  notifications, and server tests.
- `supabase/functions/submit-feedback/index.ts` and
  `supabase/functions/notify-feedback/index.ts`: authenticated entry points.
- `supabase/migrations/202610020001_feedback.sql`: table, constraints, indexes,
  RLS, column grants, rate limiting, deduplication, notification leases.
- `supabase/migrations/202610020002_feedback_notifications.sql`: private Cron
  dispatcher using Vault and pg_net.
- `supabase/migrations/202610020003_feedback_unicode_whitespace.sql`: prevents
  Unicode whitespace-only messages through direct Data API inserts.
- `supabase/config.toml`, `supabase/functions/deno.json`, `deno.lock`,
  `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`: function configuration
  and reproducible shared-schema dependency resolution.
- `scripts/feedback/`: isolated database, browser component, and opt-in live tests.

## Validation

Passed workspace typecheck, all existing mobile tests, six new server tests,
PostgreSQL migration/security tests, browser component interaction tests,
production Expo web export, and live Supabase database lint with no findings.
Live integration verified a real Auth user's save, invalid input rejection,
identity protection, denied reads/updates/deletes, request deduplication,
protected worker access, server-triggered notification failure, and retained
feedback. The isolated test row and test Auth user were deleted afterward.
Frontend and exported-bundle scans found no recipient or server secrets.

The component browser harness uses React Native Web with lightweight native
adapters and controlled transport; it is not an iOS/Android device test. It
covers opening, email prefill/removal, empty and invalid email validation,
character cap, selected category, disabled loading, duplicate clicks, retry
keys, success/reset, narrow layouts, and focus restoration. Existing semantic
theme colors and Inter typography are reused. The form now uses v2’s shared glass surfaces, buttons, accessibility preferences,
and light/dark theme resolver. Action and body text contrast is checked in all
eight appearance/color-scheme combinations.

Reproduce checks:

```sh
pnpm run typecheck
pnpm --filter @workspace/mobile run test
npm exec --yes --package=deno -- deno test --config supabase/functions/deno.json supabase/functions/_shared/feedback.test.ts
npm exec --yes --package=deno -- deno check --config supabase/functions/deno.json supabase/functions/submit-feedback/index.ts supabase/functions/notify-feedback/index.ts
pnpm --filter @workspace/mobile exec expo export --platform web --output-dir /tmp/homie-feedback-web
pnpm exec supabase db lint --linked --level error

# Disposable test dependencies, outside the repository:
npm install --prefix /tmp/homie-feedback-tests @electric-sql/pglite playwright esbuild
node scripts/feedback/test-database.mjs /tmp/homie-feedback-tests/node_modules/@electric-sql/pglite/dist/index.js
# Browser harness expects installed Google Chrome:
node scripts/feedback/test-ui.mjs /tmp/homie-feedback-tests/node_modules

# Optional live test: creates/removes its own user and feedback. If email is
# configured, it sends one clearly labeled test notification.
python3 scripts/feedback/test-live.py YOUR_PROJECT_REF
```

The live Python test requires a working system CA trust store. On this Mac it
was run with `SSL_CERT_FILE=/etc/ssl/cert.pem`; TLS verification stayed enabled.
There is no configured repository-wide JavaScript lint command. Real inbox
receipt and native-device VoiceOver/TalkBack behavior remain unverified.
