# SweetMate website and Google verification

Prepared November 12, 2026 against canonical `homiev2/main`. GitHub redirects `lianawarnaku/homiev2` to the renamed `lianawarnaku/SweetMate` repository (same repository ID).

## November 26 launch-checklist status

- Live HTTP checks: homepage and `/privacy` returned 200; `/support` and
  `/delete-account` returned 404. The successful privacy response was a reachability
  check. A later content audit confirmed the live policy omits the current
  Calendar/Tasks imports, Limited Use and optional telemetry disclosures.
- Read-only production secret-name checks confirmed `APPLE_OAUTH_CLIENT_ID` and
  `APPLE_OAUTH_CLIENT_SECRET` exist. This supersedes the older missing-secret
  note; it does not verify their values, expiry or physical-device revocation.
- iOS 27 compilation is complete in signed build 54: `iphoneos27.2`, Xcode 27.2,
  scene lifecycle and callback scheme verified. See [build 54](testflight-54.md).
- Google Search Console domain ownership was verified for sweetmate.info on
  November 26 after owner approval. The existing SweetMate app logo was saved in
  Google Auth Platform Branding. Audience remains Testing; no verification
  submission has been made. See [the current evidence and review package](google-public-access-2026-11-26.md).
- Remaining public-launch work: Google public access/branding/scope verification,
  publish missing support/deletion pages and review the live policy, physical
  iPhone auth/deletion/feature tests, analytics retention/erasure and matching
  App Store privacy/listing declarations.
- The optional `auth.sweetmate.info` paid custom domain remains deferred at the
  owner's request. No purchase is authorized by this checklist.

## Release-polish reminder — November 25, 2026

The owner asked to be reminded of Google OAuth publication and verification when
starting final release/publication polishing. Raise this checklist during that
work; it is a contextual reminder, not a scheduled notification.

- [ ] Remind the owner to change Google Auth Platform project `homie-502522` from
  **External / Testing** to **External / In production** and complete Google
  verification for public Calendar/Tasks access. Publishing alone leaves the
  unverified warning and lifetime user cap in place.
- [ ] Check the live SweetMate homepage, privacy policy, domain ownership,
  branding, support email, and developer contacts. Confirm the policy reflects
  Calendar/Tasks imports and synchronization as well as chore export and optional
  roommate Busy status sharing.
- [ ] Review and declare the permissions used by the release build, currently
  `calendar.events`, `calendar.calendarlist.readonly`, and `tasks.readonly`, plus
  basic Google sign-in. Prepare a justification for each and assess narrower scopes.
- [ ] Complete branding verification/publication and submit the relevant data
  access scopes through Verification Center with a demonstration video covering
  consent and each requested feature.
- [ ] After approval, verify connection using an account outside the test-user
  list and confirm the expected import/export behavior.

The existing supplied Google client pair is working in TestFlight; see
[the November 25 repair record](google-calendar-connection-repair.md). No new
credentials or native build are needed merely to change Google's publishing
settings. Google Workspace administrators can still restrict organizational access.
The November 12 preparation notes below are historical and must be checked against
current implementation and live website state during final release review.

## Prepared website changes

- `/privacy`: operator Liana Amanthi Warnakulasooriya, Massachusetts, United States; monitored contact support@sweetmate.info (confirmed by owner). Documents Google sign-in separately from Calendar, event payload, backend credential storage, disconnection, Limited Use, optional telemetry, retention, and current deletion behavior.
- `/support`: support contact and Calendar troubleshooting.
- `/delete-account`: in-app deletion, retained shared facts, exported copies, and an email assistance route.
- `/`: existing branding retained, footer links added, primary action uses the TestFlight invitation already in README. Invitation availability has not been tested on an iPhone.
- Existing `/auth/confirm` behavior preserved. The native `auth/callback.tsx` route redirects to `/`; its use as an app-opening link was intentional, not a broken authentication flow.

## Evidence from implementation

- `artifacts/mobile/components/SignInScreen.tsx`: sign-in does not add Calendar scopes.
- `artifacts/mobile/lib/googleCalendarConnection.ts`: explicit Calendar flow requests calendar.events and offline access.
- `supabase/functions/_shared/calendar.ts`: checks linked Google identity, stores tokens server-side, inserts into primary/events; all-day dates; title plus optional assignee, household, category and description; deterministic occurrence event ID; duplicate insert returns alreadyAdded; no calendar list/import. A repeat export does not update the existing event.
- `supabase/migrations/202608260004_google_calendar_connections.sql`: per-user credentials with RLS enabled and no ordinary-client policies.
- Calendar disconnect attempts revocation and deletes the stored connection even when the revocation request fails. Users can revoke access through Google Account connections.
- `supabase/functions/delete-account/index.ts`, `_shared/account-deletion.ts`, and account-deletion migrations: provider revocation precedes deletion; private data removed; shared financial/borrowing facts anonymized; exported events/reminders remain; telemetry erasure requires separate vendor processing.
- `artifacts/mobile/lib/analytics.ts`: optional consent, selected events and payload filtering. No retention durations were invented; provider settings must be checked separately.

## Publication blocker

The checked-in `homie-web/.openai/hosting.json` identifies
`appgprj_6a62bd55b224819188110603492229f2`. The original archived local Codex chat,
**Add user preferences system** (`019f9015-05f7-7ad2-bded-867b829b68a0`, July 23),
contains the successful creation, attachment of sweetmate.info, and version-2
publication through OpenAI Sites. This resolves the earlier uncertainty about
which project originally hosted the domain. The exact public OpenAI verification
record also remains in Cloudflare DNS. The authenticated Cloudflare account has
no Workers or Pages projects.

Current Sites get_site returns legacy Homie metadata, but source credentials,
version reads/listing and domain listing return project_not_found. Both owner and
editor Site inventories are empty; the browser's Sites library is also empty.
Finding the original chat does not restore current publication access. No working
editor URL was returned. Restore access to this legacy Site and inspect its
current source before publication, preserving auth confirmation and production
environment values. Do not reuse expired historical credentials or silently move
hosting/repoint DNS. Exact recovery identifiers are in the linked evidence file.

The November 12 preparation did not publish or change external configuration.
On November 26, the owner-approved Google TXT was added and Search Console
ownership verified; Google branding now has the app logo. The prepared website update remains
unpublished, and OAuth audience/scopes and verification submission remain unchanged.

## Public DNS observations

On November 12, public DNS showed Cloudflare nameservers, Cloudflare email-routing MX records and SPF. The apex TXT response contained SPF but no google-site-verification token. This does not prove Search Console is unverified: other verification methods or accounts may apply. The www hostname returned NXDOMAIN. Use apex HTTPS URLs unless www is deliberately configured. The owner confirms the support inbox is monitored; no email was sent to test it.

## Exact release URLs

- Homepage: https://sweetmate.info/
- Privacy: https://sweetmate.info/privacy
- Support: https://sweetmate.info/support (new source; not live yet)
- Account deletion: https://sweetmate.info/delete-account (new source; not live yet)

After publication, verify these are public without sign-in. Use identical homepage/privacy URLs and SweetMate branding in Google Cloud project homie-502522 and App Store Connect. The November 26 Google console audit confirmed the homepage and privacy URLs.
The older App Store listing URL checks below remain separate from that audit.

## Historical November 12 next steps

These build-47 notes are historical. Use the November 26 audit linked above for
current scope requirements, completed domain verification and remaining gates.

1. Verify Search Console ownership with an account that is owner/editor of the Google Cloud project. If DNS verification is needed, obtain the exact Google-provided TXT value; do not invent one or overwrite SPF/MX.
2. Review calendar.events. The current primary-calendar insert may fit calendar.events.owned, but confirm against Google documentation and a real-account test before changing both mobile scope and backend scope validation. calendar.app.created would require a dedicated-calendar implementation, which does not exist today. No scopes changed here.
3. Test build 47: connect the approved Google account, export a dated chore, confirm the all-day date and popup reminder in the primary calendar, repeat export and confirm no duplicate, disconnect, reconnect. Current export does not set a time of day. Verify cancellation and failed/revoked grants. No real Calendar connection was tested here.
4. Record iPhone demo: SweetMate branding, full English OAuth consent and exact requested scope, Calendar connection, explicit export, resulting event and its data, disconnection. Use dummy household content.
5. Explain why the selected permission is needed and why narrower alternatives do not support implemented behavior. Do not submit a calendar.events justification before completing the narrower-scope assessment.
6. Submit only after deployed policy, console branding and tested build agree. Production status alone is not verification.

Requirements: https://support.google.com/cloud/answer/13464321?hl=en
Scope review: https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification

## Validation of this change

Production Vinext build passed. Direct calls to the built Worker returned HTTP 200 for `/`, `/privacy`, `/support`, `/delete-account`, and `/auth/confirm`; expected page content and absence of policy placeholders were checked. `git diff --check` passed. Interactive browser and physical-device testing were unavailable; no preview browser was installed. Existing starter skeleton tests were not used because they still assert the deleted starter UI.
