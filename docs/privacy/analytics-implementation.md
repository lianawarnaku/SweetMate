# SweetMate analytics and diagnostics

Implementation date: 2026-07-26

SweetMate integrates PostHog for optional product analytics and Sentry for
optional crash diagnostics. Both controls are per-user, default off, and are
loaded from user-scoped device storage before either SDK is initialized. Turning
a control off resets its vendor identity. Production keys must be supplied via
the matching EAS environment; no keys are committed.

`artifacts/mobile/lib/analytics.ts` is the only vendor boundary. It owns the
typed event catalog, common technical properties, opaque per-user identifiers,
the sensitive-key denylist, environment tags, identity reset, and Sentry
scrubbing. Automatic event capture, lifecycle capture, tracing, session replay,
default PII, request data, console breadcrumbs, and network breadcrumbs are
disabled.

The central catalog includes account creation; Sweet create/join/switch and
first-invite activation; invite copy/share; chore create/first-create,
complete/first-complete, reassign, delete, and planning; shopping list/item and
shopping-to-expense; expense/IOU create and settle; borrowing create/return;
nudge send; calendar export; Quick Guide open/complete; normalized workflow
failure; and bucketed performance timing. Callers must use
the named `track` methods, not vendor SDKs or free-form event strings. Allowed
properties are booleans or small enumerations; content, names, IDs, money
amounts, dates, and free text are not approved.

Sweet Essentials uses deterministic on-device shortlist selection. PostHog may
receive `shortlist_opened`, `shortlist_saved`, and
`shortlist_sent_to_shopping` with count buckets and a fixed source value only.
It never receives item labels, category text, Sweet IDs, owned-item records, or
assignment details. The shortlist flow does not call an AI or recommendation
service.

Sentry receives exceptions only after opt-in. The runtime diagnostics bridge
removes request data, limits extras to primitive values, filters denied keys,
uses only an opaque user ID, and disables tracing. Source-map upload is deferred
until CI has a Sentry organization, project, and auth token.

EAS Observe is not installed. Its native client currently requires Expo SDK 55
or later, while this app uses SDK 54. Reassess after the SDK upgrade and update
the policy and store disclosures before enabling it.

Required release configuration:

- `EXPO_PUBLIC_APP_ENV` with separate development, preview, and production values.
- `EXPO_PUBLIC_POSTHOG_API_KEY` and `EXPO_PUBLIC_POSTHOG_HOST`.
- `EXPO_PUBLIC_SENTRY_DSN`.
- Separate vendor projects or rigorously filtered environments for non-production data.
- Vendor retention, region, DPA/subprocessor, access, deletion, and breach settings completed.

Manual verification:

1. New and existing accounts see versioned notice `2026-07-26`.
2. With both settings off, vendor dashboards receive no device traffic.
3. Enabling one setting does not enable the other.
4. Sign-out and account switch reset the vendor identity.
5. Sample events contain only the cataloged event and technical properties.
6. Test errors contain no household content, email, URL/query, request payload,
   console text, token, or invite code.
7. Development, preview, and production records remain separated.

Account deletion resets the active PostHog and Sentry identities and removes
future association on the device. Deletion from vendor systems requires the
owner procedure in the vendor checklist; aggregated/deidentified statistics may
not be attributable or removable. Complete that procedure before promising
vendor-side deletion to users.

## Production connection

Configured on 2026-11-07 in the EAS `production` environment for Expo project
`66fa0c25-5e31-481a-ae0a-0a057806cf27`:

- PostHog project: `719267` (US region).
- Dashboard: https://us.posthog.com/project/719267/home
- `EXPO_PUBLIC_POSTHOG_API_KEY`: saved as an EAS sensitive variable; do not commit its value.
- `EXPO_PUBLIC_POSTHOG_HOST`: `https://us.i.posthog.com`.
- `EXPO_PUBLIC_APP_ENV`: `production`.

A synthetic `analytics_connection_test` event with environment `connection-test`
was accepted and PostHog marked installation complete. Exclude that environment
from product reporting. No user content was used for this check. Setup uses the
free plan with frontend autocapture, heatmaps, web-vitals capture, and session
replay disabled.

Installed builds created before this configuration do not receive these values
retroactively. A separately authorized production build and release is required
before opted-in devices can send product events. Connecting the project does not
authorize a TestFlight release.

The consent boundary explicitly calls `optIn()` when a user enables product
analytics, clearing the SDK's persisted opt-out state from an earlier disable.
`pnpm --filter @workspace/mobile test:analytics` exercises consent and identity
behavior with local SDK/storage stubs and no network requests.
