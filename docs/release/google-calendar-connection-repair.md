# Google Calendar connection repair

## Observed failure

On November 24, the iPhone returned from Google successfully but `POST /functions/v1/calendar/connect` failed. Sanitized diagnostics from the user's retry identified Google's token endpoint returning HTTP 401 with `invalid_client`.

The deployed Calendar client secret matched the masked value returned by the Supabase Auth configuration API, rather than a usable full Google client secret. A deliberately invalid diagnostic refresh grant confirmed that these configured credentials are rejected with `invalid_client`. The owner's separate local QA client has valid credentials, but its client ID differs from production and cannot refresh production's grants.

The original repair plan was to recover the full secret for the existing production OAuth client. On November 25, the owner instead explicitly requested that production use the complete working client ID/secret pair they supplied in a private local file. This requires changing both Supabase Google sign-in and the Calendar server together. Updating Edge secrets alone would leave newly issued Google refresh tokens tied to a different client. Masked Auth API values must never be reused as credentials.

## Changes prepared

- Calendar identity verification uses the same Google OAuth2 user-info endpoint as Supabase Auth and accepts its `id` field, retaining the linked-account ownership check. New clients explicitly request OpenID/profile/email alongside Calendar and Tasks permissions.
- Safe server diagnostics contain only a fixed stage, numeric HTTP status, and whitelisted provider error code. No tokens, identities, payloads, or Google's free-form descriptions are logged.
- Invalid Google client credentials produce a server-configuration error (503), rather than telling users to repeatedly reconnect (401).
- My Sweet's grey link starts connection when necessary and then loads calendar/task selection. Both entry points share one user-scoped, server-verified connection state.
- Status refreshes on focus and foreground; delayed earlier responses cannot reset a successful connection. Duplicate taps share one OAuth operation. Errors remain visible after navigation, and failed checks allow retry.

## Validation and distribution

Workspace type checks, the full mobile suite, backend integration tests, the Google schedule suite, and an iOS Hermes export passed. Targeted tests cover stale checks, shared subscribers, failed persistence, retries, duplicate taps, account isolation, Google OAuth2 identity responses, and sanitized credential failures.

Commit `126f92f555a0306ac0b993551eb51e7b7a1bb272` was built as iOS 1.0.0 (49), EAS build `7afaa609-e421-402d-ace6-35c4503c9226`. The user then requested no further build yet. Its TestFlight submission `80dd3f67-ea64-4e2b-a5ee-b1df5afa0dc5` was canceled and independently verified `CANCELED`. That submission was verified canceled at the time. On November 25, the owner reported SweetMate 1.0.0 (49) installed on their iPhone. Read-only inspection of the existing EAS archive confirmed native build 49 and the expected calendar/dark-card code. Use build 49 as this device’s diagnostic baseline; App Store Connect distribution was not rechecked during that inspection. No new build or submission was initiated.

The server validation/diagnostic changes are deployed. On November 25, after the client consolidation below, the owner confirmed that connecting Google Calendar works in the existing iPhone TestFlight app. No household records, roommates, chore charts, or saved chores were modified during diagnosis.

## November 25: consolidate production onto the supplied pair

The owner authorized using the existing **SweetMate Calendar Server** web client for production. It belongs to the same Google Cloud project (`homie-502522`) as the former production client.

- Target public client ID: `653392398023-33rp4a9o7dhnrk9gabibl4jg9lit1j59.apps.googleusercontent.com`.
- Added and saved `https://eqnogaftebuqfwwelbdx.supabase.co/auth/v1/callback` to that client's authorized redirect URIs. Existing local callbacks were retained.
- Verified Google's token endpoint accepts the supplied pair using a deliberately invalid diagnostic refresh grant. The expected response was `invalid_grant`, rather than `invalid_client`; no real user grant was used.
- Updated production `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`, then redeployed the existing `calendar` and `google-schedule` functions to load them.
- Updated only `external_google_client_id` and `external_google_secret` in Supabase Auth to use the same pair. Email/Apple authentication, session settings, native redirect allowlist, and user identities were retained.
- Confirmed the live Supabase Google authorization endpoint redirects to Google using the target client and production callback. Verified the Edge secret digests against the private supplied values. Auth returns an opaque masked secret; its changed readback confirms the update, but is not a reusable credential or the Edge API's secret digest.
- Confirmed Calendar API was enabled. Enabled the previously missing Google Tasks API and verified its Google Cloud status is **Enabled**.

Before/after row fingerprints were identical for 16 Auth users, 18 linked identities, 15 households, 18 memberships, and 666 saved chores. Calendar connections and personal schedule preferences both remained empty during the configuration checks. No accounts or household data were migrated or recreated.

The Google Cloud audience remains **External / Testing**, with the owner's Google account listed as the allowed tester. This consolidation does not publish the Google OAuth app or grant additional users access. Existing TestFlight build 48 can pick up the server configuration without a new native build. After retrying Connect Google Calendar, the owner reported “It works!!” on November 25. This confirms the user-facing connection flow in the existing TestFlight app; the owner later identified the installed version as 1.0.0 (49). Calendar import selection and subsequent background sync were not independently exercised in that confirmation.
