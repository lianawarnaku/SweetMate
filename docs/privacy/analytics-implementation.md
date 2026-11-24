# SweetMate analytics and diagnostics

Updated 2026-11-23. The single vendor boundary is
`artifacts/mobile/lib/analytics.ts`. New behavior ships only in a new app build;
this implementation does not release to TestFlight or change remote vendor configuration.

## Consent

First-time signup presents an optional, initially unchecked checkbox directly
beneath Create Account, with a link to the Privacy Statement. Checking it opts
into both product analytics and sanitized crash reporting. Leaving it unchecked
does not block signup and leaves both categories off. The former consent modal
is no longer shown, and sign-in does not depend on a telemetry choice.

The selection is persisted only for the successful signup attempt and account.
Email-confirmation flows stage the account-scoped choice without initializing
SDKs. Existing accounts retain their saved choices. Cancelled and failed OAuth
attempts do not enable collection. A fresh signed-out screen discards legacy
anonymous consent so another person cannot inherit it. Settings retains separate
product-analytics and crash-reporting controls for later changes.

## Identity and measurement

Preferences and random `sm_*` analytics IDs remain scoped to the account on
this device. Existing accounts retain their opaque IDs. Sign-out resets vendor
identity; account deletion removes local preferences, IDs, and first-event
markers. Vendor-side deletion remains an owner procedure, not a local deletion.

There is no refusal event, pre-consent event queue, or historical backfill.
Active-session opt-in records `analytics_consent_granted` with source `signup`
or `settings`; legacy event sources remain recognized. Collection begins only
once the saved choice permits it. SDK transitions remain serialized with revision
guards, and auth success stays tied to the current attempt so a late response
cannot reactivate a signed-out account.

IDs are per account **per device**, not global account IDs. Multi-device use,
reinstall/storage clearing, and consent coverage limit unique-user and retention
interpretations. Household identifiers and group profiles are not sent.

## What is recorded and why

| Events | Purpose |
| --- | --- |
| `app_opened`, `screen_viewed`, `app_active_time` | Returning usage, navigation adoption, engaged foreground time |
| `auth_started`, `auth_succeeded`, `account_created` | Opted-in auth conversion; account_created is confirmed email signup only |
| `onboarding_started`, `onboarding_step_viewed`, `onboarding_step_completed`, `onboarding_completed`, `onboarding_cancelled` | Setup drop-off, skipped steps, first/additional household flows, preferences setup |
| `sweet_created`, `sweet_joined`, `sweet_switched` | Household adoption and switching |
| `invite_copied`, `invite_shared`, `first_sweetmate_invited` | Invite actions; copied/shared is not proof someone joined |
| `chore_created`, `chore_batch_created`, `chore_completed`, `chore_undone`, `chore_deleted`, `first_chore_created`, `first_chore_completed` | Chore adoption, first tracked value, ongoing actions and undo |
| `chore_plan_created`, `chore_plan_applied` | Successful planner proposal/apply RPC calls and coarse chart size |
| `shopping_list_created`, `shopping_item_added`, `shopping_item_completed`, `shopping_item_reopened` | Shopping adoption and completed/reopened actions |
| `expense_created`, `expense_repayment_recorded`, `iou_settled` | Expense use, partial/final repayment, settlement with manual/repayment source |
| `borrowing_item_added`, `borrowing_return_requested`, `borrowing_item_returned`, `borrowing_return_undone` | Borrow workflow with requests, confirmed return, and undo separated |
| `nudge_sent`, `quick_guide_opened`, `quick_guide_completed` | Nudges, guide reach and explicit acknowledgement |
| `shortlist_opened`, `shortlist_saved`, `shortlist_sent_to_shopping` | Essentials shortlist adoption and explicit transfer |
| `workflow_failed` | Reported errors classified into fixed feature/operation/category values, independent of crash opt-in |

All events include platform, app version, build number, environment,
`analytics_schema_version=2`, and `update_id=null` (no misleading project ID).
Feature properties are fixed enums, booleans, aggregate count buckets `0`, `1_5`,
`6_10`, `11_plus`, category counts, and foreground duration seconds. Item-count
metadata is explicitly allowed; item text and other sensitive property keys are
filtered. No names, email addresses, content, household/account IDs, invite codes,
amounts, tokens, raw routes/query parameters, or free-form error text are sent by
these explicit events. PostHog SDK technical metadata still applies.

Session replay, automatic lifecycle capture, and feature-flag preloading are off.
Screen tracking is explicit and uses an allowlist. Auth/setup gates override the
underlying router path so setup is not mislabeled My Sweet. Consecutive duplicate
screen renders are ignored; revisiting a tab records another visit. Foreground
returns record another app open. Signup identity transfer does not count another
open. Time uses monotonic whole-second deltas every 30 seconds and on background,
with a best-effort SDK flush. Background/inactive/hidden-web-tab time is excluded.
An abrupt OS kill can lose the final partial interval; this is an estimate of
visible foreground use, not proof of interaction or exact session length.

## Interpretation limits

- First-action events mean first tracked action per account/device storage, not
  necessarily the first action ever. They are not emitted for declined users.
- Most local feature events describe accepted optimistic UI actions, not confirmed
  database transactions. Sync may fail later. This release does not rewrite sync.
- Household creation/join, chart proposal/application, nudge, and shortlist save
  events follow their successful server calls. Chart apply is deduplicated per
  chart in the current runtime, not across every device; the idempotent RPC does
  not return a distinct “newly applied” result.
- Chore checkoff -> undo -> checkoff legitimately records two completion actions
  and one undo. Do not treat gross event totals as unique chore inventory counts.
- Return requests, confirmed returns, and undo now have separate events. Expense
  repayments report partial/final status and final settlement. Repeated same-state
  local actions are ignored. Use schema version 2 to exclude older misleading
  borrowing/settlement records.
- Onboarding context survives route remounts in the same app runtime. A process
  restart labels resumed steps but may infer first/additional context from the
  restored route. Setup cancellation is an explicit action; killing the app is
  inferred from an unfinished funnel rather than a fabricated cancel event.
- OAuth success does not claim new-account creation, because OAuth callbacks do
  not reliably distinguish a new user from an existing account.
- Some catalog entries remain reserved, without emitters: chore reassignment,
  shopping-expense/IOU-specific creation, calendar export, performance buckets.
  `workflow_failed` covers reported runtime failures, not all possible API errors.

## Useful PostHog reports

Filter `environment=production`, exclude `connection-test`, and use
`analytics_schema_version=2` for the revised behavior.

1. Active devices/profiles: unique IDs performing `app_opened` by day/week.
2. Feature adoption: unique IDs by `screen_viewed.screen` and feature actions.
3. Engagement: sum `app_active_time.duration_seconds`. For per-user averages,
   divide summed seconds by unique IDs in the same period; averaging checkpoint
   event duration is not average session length.
4. Activation: consent -> successful email signup -> household -> first chore
   created/completed. Filter onboarding flow/context consistently and remember
   declines are absent, not failed conversions.
5. Shopping, borrowing, and expense action trends with undo/request/source split.
6. Setup step conversion and workflow failure rate by feature/build.

These are suggested reports; no dashboards or alerts are provisioned by this change.

## Diagnostics and checks

Sentry remains separately off unless enabled and a DSN is provided. It removes
request/message data, masks exception text, filters primitive extras, suppresses
console/network breadcrumbs, disables tracing, and rebinds the current opaque
identity after an account switch. Deferred errors carrying another account's ID
are dropped. Source-map upload still needs CI organization/project/auth configuration.

Required release values remain `EXPO_PUBLIC_APP_ENV`,
`EXPO_PUBLIC_POSTHOG_API_KEY`, `EXPO_PUBLIC_POSTHOG_HOST`, and optional
`EXPO_PUBLIC_SENTRY_DSN`. Keep vendor projects or environment filters separate.
Do not commit keys. Sentry production configuration is not verified by this task.

`pnpm --filter @workspace/mobile test` includes actual vendor-boundary stub tests,
a foreground lifecycle state machine, onboarding transitions, actual AppContext
action callback tests, and workflow-classification/privacy tests. They exercise
opt-out/default-off/re-consent, pre-auth identity adoption, stale auth callbacks,
account switches, duplicate actions, foreground-only timing, safe routes, and
sensitive-property filtering, without sending network events. Real delivery from
a released build still needs verification in PostHog after a separately authorized
release. Store-disclosure worksheets and the local privacy-page source describe
the expanded optional collection; this does not publish the website or stores.

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
