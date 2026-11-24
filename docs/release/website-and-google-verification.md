# SweetMate website and Google verification

Prepared November 12, 2026 against canonical `homiev2/main`. GitHub redirects `lianawarnaku/homiev2` to the renamed `lianawarnaku/SweetMate` repository (same repository ID).

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

The checked-in `homie-web/.openai/hosting.json` identifies `appgprj_6a62bd55b224819188110603492229f2`. Sites get_site returns legacy Homie metadata and a homie-application.com live URL, but list_custom_domains and create_source_repository_write_credential return project_not_found. Owner and editor list_sites calls return no Sites. This does not establish that this project currently serves sweetmate.info. Do not deploy to a new site or repoint DNS on that assumption. Restore access to the Site that actually serves sweetmate.info and inspect its authoritative source before publication, preserving auth confirmation and production environment values.

No production publication, DNS mutation, OAuth configuration change, App Store Connect update, or verification submission was performed.

## Public DNS observations

On November 12, public DNS showed Cloudflare nameservers, Cloudflare email-routing MX records and SPF. The apex TXT response contained SPF but no google-site-verification token. This does not prove Search Console is unverified: other verification methods or accounts may apply. The www hostname returned NXDOMAIN. Use apex HTTPS URLs unless www is deliberately configured. The owner confirms the support inbox is monitored; no email was sent to test it.

## Exact release URLs

- Homepage: https://sweetmate.info/
- Privacy: https://sweetmate.info/privacy
- Support: https://sweetmate.info/support (new source; not live yet)
- Account deletion: https://sweetmate.info/delete-account (new source; not live yet)

After publication, verify these are public without sign-in. Use identical homepage/privacy URLs and SweetMate branding in Google Cloud project homie-502522 and App Store Connect. These private console settings have not been inspected in this session.

## Remaining Google steps

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
