# Google Calendar connection repair

## Observed failure

On November 24, the iPhone returned from Google successfully but `POST /functions/v1/calendar/connect` failed. Sanitized diagnostics from the user's retry identified Google's token endpoint returning HTTP 401 with `invalid_client`.

The deployed Calendar client secret matched the masked value returned by the Supabase Auth configuration API, rather than a usable full Google client secret. A deliberately invalid diagnostic refresh grant confirmed that these configured credentials are rejected with `invalid_client`. The owner's separate local QA client has valid credentials, but its client ID differs from production and cannot refresh production's grants.

The repair requires a full active secret for the exact production Google OAuth client ID. Update only the server's `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` after validating the matching pair. Do not copy masked Auth API values into Edge secrets. Do not change the production Google sign-in provider or replace it with the unrelated QA client. Credentials remain in private local files and server secrets.

## Changes prepared

- Calendar identity verification uses the same Google OAuth2 user-info endpoint as Supabase Auth and accepts its `id` field, retaining the linked-account ownership check. New clients explicitly request OpenID/profile/email alongside Calendar and Tasks permissions.
- Safe server diagnostics contain only a fixed stage, numeric HTTP status, and whitelisted provider error code. No tokens, identities, payloads, or Google's free-form descriptions are logged.
- Invalid Google client credentials produce a server-configuration error (503), rather than telling users to repeatedly reconnect (401).
- My Sweet's grey link starts connection when necessary and then loads calendar/task selection. Both entry points share one user-scoped, server-verified connection state.
- Status refreshes on focus and foreground; delayed earlier responses cannot reset a successful connection. Duplicate taps share one OAuth operation. Errors remain visible after navigation, and failed checks allow retry.

## Validation and distribution

Workspace type checks, the full mobile suite, backend integration tests, the Google schedule suite, and an iOS Hermes export passed. Targeted tests cover stale checks, shared subscribers, failed persistence, retries, duplicate taps, account isolation, Google OAuth2 identity responses, and sanitized credential failures.

Commit `126f92f555a0306ac0b993551eb51e7b7a1bb272` was built as iOS 1.0.0 (49), EAS build `7afaa609-e421-402d-ace6-35c4503c9226`. The user then requested no further build yet. Its TestFlight submission `80dd3f67-ea64-4e2b-a5ee-b1df5afa0dc5` was canceled and independently verified `CANCELED`. The binary has not been released to TestFlight. Build 48 remains the published version.

The server validation/diagnostic changes are deployed. The matching full production secret and a successful iPhone connection retry remain required before declaring the connection repaired. No household records, roommates, chore charts, or saved chores were modified during diagnosis.
