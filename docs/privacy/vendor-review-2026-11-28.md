# Vendor/privacy execution record — November 28, 2026

The owner requested completing Google public access and vendor/privacy work,
without purchases or a new TestFlight build. This record contains verified facts;
it does not mark the open console work complete.

## Current production configuration

Read the existing Expo production **project** and **account-wide** environments
through the official EAS CLI. Values were not displayed or committed. The project
has the existing PostHog US ingestion endpoint and no EXPO_PUBLIC_SENTRY_DSN or
SENTRY_AUTH_TOKEN; the account scope has no variables. The item-name analytics
flag is absent and the source defaults it off. No environment value was changed.

The actual analytics boundary initializes Sentry only when both consent and a DSN
are present. There is no Sentry native plugin in the reviewed Expo configuration.
Sentry is therefore **inactive in the current reviewed production configuration**,
rather than an active vendor whose retention dashboard was verified. This does not
prove the configuration of every historical binary or Apple's own TestFlight crash
handling. Do not create a Sentry account, buy a plan or enable reporting merely to
fill this checklist. Before future activation, verify the actual project's region,
DPA, retention, access and erasure process and reconcile shipped disclosures.

The reviewed source has no EAS Observe package/configuration or direct expo-updates
dependency. This is evidence about the app integration, not a claim that every Expo
account setting was inspected. EAS remains a build/distribution provider; Expo push
processing is separate from optional product analytics.

Production Supabase read-only aggregates: **zero vendor-erasure requests**, zero
pending/completed requests; queue RLS enabled, anonymous/authenticated SELECT
privileges false. No analytics identifier or private user record was output.
The existing queue receives the deleting device's pseudonymous ID. An operator
must verify a request, use the vendor's supported person **and associated events**
erasure workflow, retain evidence of acceptance, and only then mark completion.
An accepted asynchronous deletion must not be advertised as immediate physical
removal from vendor storage or backups. Other-device IDs are not centrally mapped.

## Provider documentation review

- [PostHog retention](https://posthog.com/docs/data/events-retention): Free has a
  one-year event window; custom retention requires paid plans. This is the vendor
  rule, now also verified in SweetMate's live project: **Free / Organization
  default (1 year)**. Retention was not changed, preserving the owner's choice.
  Do not shorten it or promise permanent event storage on the Free plan.
- [PostHog storage/deletion](https://posthog.com/docs/privacy/data-storage): person
  profiles are separate from event retention; deleting a person alone must include
  the supported associated-data option. Cleanup and backup expiry are asynchronous.
- [PostHog DPA](https://posthog.com/dpa) and
  [subprocessors](https://posthog.com/subprocessors): reviewed the current public
  templates/list, including US cloud storage and cross-border arrangements. This
  does not show a completed agreement. The owner subsequently sent the DPA for
  signature; the live legal-documents table shows **Awaiting signature** and no
  signed copy. No countersignature was performed by the agent.
- [Sentry DPA](https://sentry.io/legal/dpa/) and
  [subprocessors](https://sentry.io/legal/subprocessors/) were reviewed for future
  activation. No Sentry dashboard, region, agreement or erasure was falsely certified.
- [Expo security](https://expo.dev/security) describes ephemeral build workers,
  build log/artifact retention, encryption and push handling. Keep operational
  transport/security logs distinct from optional app analytics and GPS tracking.

## Live PostHog account checks

Recovered the existing native Chrome session without changing browser permissions
or creating credentials. The project is **US Cloud**, **Free**, with inherited
**Organization default (1 year)** event retention. The member list contains only
the owner and no outstanding invitations. Granular access controls and enforced
team MFA are paid features; none were purchased. Individual owner MFA was off at
the observed Profile page, and the free authenticator Setup was handed to the owner.
The agent did not generate/view an enrollment secret or recovery codes.

Verified replay, web autocapture, web-vitals and dead-click capture are off.
Discard client IP is on. The GeoIP transformation is Paused and the SweetMate
location-metadata filter is Active. No outbound destinations or other integrations
are configured; the destination onboarding screen's example data is not a live
export. No configuration or existing analytics history was changed by these checks.

Created one clearly named **SweetMate privacy audit — disposable test** profile,
using the existing project ingestion token privately, location disabled and no real
user data. The provider accepted the batch and the actual person Events tab shows
exactly two synthetic entries (Identify and the audit event). The real Delete person
control is ready, but permanent deletion is awaiting action-time owner approval.
No other person/profile was opened and no real analytics was purged. This is not yet
a completed erasure drill. An asynchronous vendor deletion must be recorded with
its actual pending/completed state, not assumed instantaneous.

## Public policy update — deployed

Published the revised static privacy pages to the existing **sweetmate-website**
Cloudflare Pages Free project. The live privacy notice now states US hosting,
one-year event retention, separate person-profile expiry/asynchronous erasure,
currently inactive Sentry reporting, and both installed legacy and updated narrow
Google permissions. No agreement was falsely described as signed.

- All **10 rendered-page + 9 static/auth tests** passed.
- Existing confirmation source and generated public script hashes are unchanged.
- Local static preview and Chrome navigation verified the new text.
- Only 25 reviewed static files were uploaded; ZIP SHA-256:
  `751af75fdf1ef33b81b08f936eb3be9c416db0ce497113670c6746211481f357`.
- Cloudflare showed Success. Independent normal-TLS checks passed on both Pages
  and sweetmate.info: homepage/privacy/support/deletion/confirmation/script 200,
  unknown path 404, exact content allowing known email obfuscation, CSP and
  confirmation no-store intact. No DNS or email records changed.
- No native build, OTA update, new vendor credentials, paid plan or purchase.

## Google and browser state

Observed the existing Google Cloud project's Audience page: **External / Testing**,
one test user, Publish app control available. Existing credentials/callbacks were
preserved. Switching to production does not require buying anything or building
TestFlight. Google requires production status before preparing verification.

The owner was asked for action-time publishing approval because browser policy
requires it for expanded public access. Approval remains pending. Review still
requires a genuine end-to-end demonstration with the actual requested scopes;
Google's own decision cannot be represented as completed by local configuration.
See [Google verification requirements](https://support.google.com/cloud/answer/13464321)
and [submission steps](https://support.google.com/cloud/answer/13461325).

The initial settings load stalled browser control; it later recovered. The request
to close that temporary tab was withdrawn. A direct PostHog connection was offered
but never confirmed or required once native control recovered. The extension file
chooser later stalled; the standard native picker uploaded the prepared website
archive. No extension file permissions were expanded and no browser cookies/session
storage were extracted through other tools. The interruption was not treated as a
successful upload; the restored Cloudflare page was inspected before proceeding.

## Remaining owner/reviewer steps, without a build or purchase

1. The action-time Google publishing approval is still pending. Audience remains
   Testing. Both Calendar and Tasks APIs are already enabled; no API purchase or
   new OAuth client is needed. After approval, publish the existing audience and
   complete the actual branding/scope verification form and truthful demonstration.
   Google's review/approval and a real outside-test-list account check remain external.
2. The owner-created DPA envelope is **Awaiting signature**. Review its legal
   operator/address/email and terms before deciding to countersign. Do not mark it
   executed, delete/cancel it or resend it without the appropriate instruction.
3. The owner must create their own individual PostHog MFA credential using the
   free Setup control; no paid enforcement upgrade is needed.
4. Approve the pending permanent-delete prompt for only the disposable profile and
   its two test events, then verify the real vendor deletion status. Real history
   remains intact and the live production erasure support queue was empty.

[Sanitized verified state](vendor-review-2026-11-28/verified-state.json),
[production HTTP checks](vendor-review-2026-11-28/production-http-checks.json),
[preview HTTP checks](vendor-review-2026-11-28/preview-http-checks.json), and
[artifact hashes](vendor-review-2026-11-28/artifact-manifest.json).
Screenshots stay local because they include browser context and owner contact
information. Raw EAS output was processed privately and the two task-created
output files were removed. No keys, private address or production records were
committed. The owned loopback preview server was stopped; app/persona services
were preserved.
