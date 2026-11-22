# Apple and Google authentication verification

Audit baseline: main `81a0de29beebb9c22c66c0ae7edc5f5fa11e5799`, plus the sign-in hardening and regression coverage in this change. This is implementation and limited live-endpoint evidence, not a native-device certification.

## Confirmed live, without signing in or deleting accounts

Against the production project identified in the release documentation (`eqnogaftebuqfwwelbdx`):

- GET `/auth/v1/authorize?provider=google&redirect_to=sweetmate://auth/callback` returned HTTP 302 to accounts.google.com. The provider request uses the Supabase `/auth/v1/callback` redirect and email/profile scopes, without Calendar access.
- The corresponding Apple request returned HTTP 302 to appleid.apple.com, with service ID `com.homieapplication.homie.web`, the same Supabase callback, email/name scopes, code response and form_post mode.
- An unauthenticated POST to `/functions/v1/delete-account` returned HTTP 401 with a sign-in-required message.

These observations establish that the provider authorization entry points and deletion endpoint are deployed. They do not establish that client secrets are valid, the full native return-URL allowlist is configured, consent/token exchange succeeds, Apple revocation credentials exist, or a particular TestFlight binary matches this source. No real account was signed into or deleted. No provider or production settings were changed.

## Implementation evidence

`SignInScreen.tsx` uses the existing singleton Supabase client and WebBrowser authentication session for both providers. It requests no Calendar scopes. It handles both authorization-code callbacks and implicit access/refresh token callbacks, propagates exchange errors, and leaves cancellation/dismissal without success feedback. The native scheme is `sweetmate`, and the callback route returns to AuthGate.

The singleton uses AsyncStorage, persistSession and autoRefreshToken. `useSupabaseSession` restores a saved session and responds to sign-in, sign-out and token-refresh events. AuthGate requires a session before showing the app and keeps household loading/errors separate from a genuinely empty account.

The Apple-linked deletion helper confirms the linked account again, reads the provider refresh token from the exchanged session or callback, and refuses to submit deletion if that token is missing. The server binds the provider token to the authenticated Apple identity, exchanges/revokes it through Apple's HTTPS endpoints, disconnects a stored Google Calendar grant and only then finalizes account deletion. Failures before finalization stop deletion. Database deletion removes private records and credentials, transfers ownership when appropriate, and preserves shared financial/borrowing facts under isolated Deleted member aliases.

## Defects fixed during this audit

- A successful-looking Supabase response with no session/user ID could produce a success haptic even though login had not completed. It now shows an error and never reports success.
- React state alone left a small repeated-tap window before the sign-in button rerendered. A synchronous in-flight guard now prevents competing provider sessions and is released after success, cancellation or failure.

## Checks passed

- Workspace typecheck and complete mobile test suite.
- Actual SignInScreen callback execution with provider boundaries substituted: Apple and Google code/token flows, cancel/dismiss, denied consent, incomplete callback, missing provider URL, provider start errors, exchange/session errors, null sessions, scope separation and repeated taps.
- Actual session hook orchestration: fresh account state, saved Apple/Google session restoration, token-refresh/sign-out/sign-in events and subscription cleanup. Singleton persistence/renewal configuration is verified with the SDK boundary substituted; this does not prove an iPhone's physical storage behavior.
- Mobile deletion module: Apple code and implicit-token callbacks, cancellation, wrong-account session restoration, missing provider refresh token, server-failure preservation and per-user storage cleanup.
- Server deletion runtime: linked identity and ordering; missing Apple configuration, wrong account and token/revoke/Google/preflight failures cannot finalize deletion.
- Disposable PostgreSQL-WASM tests using the real expense/ledger/deletion migrations: service-only finalization, private cleanup, owner transfer, retained monetary totals, isolated anonymous history and stale-profile suppression.
- git diff --check.

The automated callbacks substitute vendor responses; database tests substitute the surrounding auth schema. They complement, but cannot replace, real provider/device tests.

## Still required for release confirmation

1. Inspect live Supabase Auth provider configuration and redirect allowlist. Confirm Apple service ID, Google client ID, the Supabase HTTPS callback and native `sweetmate://auth/callback` behavior. Authorization redirects alone cannot validate a client secret.
2. Check the existence of Edge Function secrets `APPLE_OAUTH_CLIENT_ID` and `APPLE_OAUTH_CLIENT_SECRET`, their service-ID/audience match and secret expiry. Earlier November 11 notes reported them absent; this audit has no authenticated management access to confirm their current state. Never put these in EXPO_PUBLIC variables or in chat.
3. Record the exact installed TestFlight version/build and its EAS source commit. The user referred to the latest version but did not supply a numeric build; no mapping is verified here. Deliver the hardened client before calling its behavior device-tested.
4. On a physical iPhone, separately test Apple and Google: fresh sign-in, cancel, returning sign-in after logout, app termination/relaunch and expired-session renewal. Confirm the same user ID and household return without duplicates or data leakage. For Apple, include Hide My Email/Share My Email as separate disposable fixtures.
5. With an owner-approved disposable Apple-linked SweetMate account, cancel deletion, reject a wrong Apple account, then complete deletion. Confirm Auth identity removal, old-session denial and Apple authorization revocation. Check linked Google/email account deletion separately. Never delete the owner's real account.
6. Record build/device, expected/actual result, timestamp and evidence for each step. Retest failures after each delivered fix. Local Avery/Blake email/password QA sessions do not test real Apple/Google OAuth.

A Supabase connection was offered for the remaining read-only configuration checks. No successful connection was confirmed during this audit.
