# Nudge notifications and Google Calendar rollout

Implementation and server rollout: November 9, 2026, from canonical main.

## Deployed server components

- Supabase `calendar`: authenticated per-user status, connect, disconnect, and duplicate-safe chore event creation. Refresh tokens remain in the existing service-role-only table. The endpoint validates Calendar scopes and matches the Google subject to the authenticated user's linked Google identity. Server errors omit tokens and raw provider responses.
- Supabase `nudge-push`: private worker token, leased per-device jobs, bounded retries, Expo receipt polling, and invalid-token disabling. SQL migrations `202611100001` and `202611100002` are deployed. A minute-based cron invokes the worker using Vault secrets. Google client credentials were configured from the existing Supabase Google provider without changing that provider.
- Native app: permission request, device registration and token refresh, logout cleanup serialized against registration, and notification navigation to the recipient's household/chore. Web retains in-app nudges. No existing scores, expenses, or memberships are migrated by this work.

## Behavior and limits

Nudges remain anonymous. Push content contains no sender identity or chore text. Devices are private, and jobs are cancelled after dismissal, device/account changes, or membership removal. Retraction deletes queued jobs; an already delivered notification cannot be unsent. Pushes to a recipient are throttled to one new nudge per minute, and stale jobs expire after 24 hours. Delivery uses a durable queue and provider receipts, but ambiguous network failures can cause a duplicate retry; a receipt confirms APNs/FCM handoff, not that a person saw the message.

Google Cloud project `homie-502522` has Calendar API enabled and the existing Supabase callback URI. The declared scopes were narrowed to calendar.events plus standard Google sign-in scopes. The app remains External/Testing; the requested owner account is already a test user. Public OAuth verification is separate from Apple's release process and remains required before unrestricted public Calendar access. Testing authorizations expire after seven days.

A new native build is mandatory for push registration. Build 44 failed because the old provisioning profile lacked Push Notifications / aps-environment. The account holder accepted the updated Apple Developer Program License Agreement on November 9. An APNs key was created and assigned, Push Notifications was enabled, and a new provisioning profile was generated using the existing distribution certificate. Build 45 and its TestFlight upload succeeded. Android additionally requires FCM v1 credentials for a separately signed Android release.

## Validation

Passed: workspace typecheck, full mobile suite, Deno checks for both new Edge Functions, seven feedback server tests, integration runtime tests, isolated PostgreSQL push security/lifecycle tests, and production Expo web export. Live checks returned 401 for unauthenticated Calendar and worker calls, and 200/processed=0 for an authorized empty worker. The deployed cron is active. No phones or Calendar connections were registered at that check; real-device notification delivery and a real Google event have not yet been verified.

Reproduce:

```sh
pnpm run typecheck
pnpm --filter @workspace/mobile run test
node scripts/integrations/test-runtime.mjs
node scripts/integrations/test-push-database.mjs /path/to/@electric-sql/pglite/dist/index.js
pnpm dlx deno check --config supabase/functions/deno.json supabase/functions/calendar/index.ts supabase/functions/nudge-push/index.ts
```

After installing the new build, validate on two signed-in physical devices: permission allowed/denied, foreground/background/terminated, logout/account switching, notification tap navigation, and retraction. Confirm queue receipts without exposing tokens. Connect Calendar with the test Google account, add the same chore twice and confirm one event, then disconnect and reconnect. Never infer real-device delivery from mocked tests alone.

Operational rollback: disable the nudge-push cron job and unregister devices if needed; preserve queue and connection records for diagnosis. Do not drop tables or reset scores. No public App Store release is part of this rollout.
