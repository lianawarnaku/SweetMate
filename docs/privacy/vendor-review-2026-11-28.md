# Vendor/privacy execution record — November 28, 2026

The owner requested completing Google public access and vendor/privacy work,
without purchases or a new TestFlight build. This record contains verified facts. Google audience publication and the corrected
DPA signature are now complete; Google verification still requires the real demo
video the owner has deferred.

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
  does not show a completed agreement. The original owner-created envelope was unsigned. With explicit action-time
  approval it was cancelled and replaced to identify the legal operator. The owner
  entered the address privately and completed the signature. PostHog now shows
  **Signed** and a signed-copy Download link; PandaDoc also offers the signed PDF.
  No countersignature was performed by the agent.
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
team MFA are paid features; none were purchased. Individual owner MFA was initially off. The owner completed enrollment, and the
authenticated connector subsequently verified **is_2fa_enabled=true**. The agent
did not generate/view an enrollment secret or recovery codes.

Verified replay, web autocapture, web-vitals and dead-click capture are off.
Discard client IP is on. The GeoIP transformation is Paused and the SweetMate
location-metadata filter is Active. No outbound destinations or other integrations
are configured; the destination onboarding screen's example data is not a live
export. No configuration or existing analytics history was changed by these checks.

Created one clearly named **SweetMate privacy audit — disposable test** profile,
using the existing project ingestion token privately, location disabled and no real
user data. The provider accepted the batch and the actual person Events tab shows
exactly two synthetic entries (Identify and the audit event). After specific owner approval, the connected vendor API accepted deletion of
only this one synthetic profile and its two events: one person found, one queued,
event deletion queued, no errors. A subsequent lookup returns 404. No real profile
or historical user analytics was deleted. Final event/storage/backup purge remains
asynchronous and unverified; person removal is not proof of physical erasure.

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
- No native build, OTA update, agent-created vendor credentials, paid plan or purchase.

## Google and browser state

Initially observed External / Testing with one test user. The owner explicitly
approved the production switch at action time. Publishing completed and the live
Audience page shows **In production / External**, with a 100-user unverified cap.
Existing credentials and callbacks were preserved; no app build or purchase was
needed. Publication is not Google verification or unrestricted access.

The automated branding check rejected the existing app logo as insufficiently
distinctive. Selected the manual-review path for the actual existing app icon.
The combined review form requires scope justification and a real YouTube demo
before submission. Entered a 902-character, source-checked explanation, including
the temporary installed-build legacy scope; Save stays disabled without the
video URL. No placeholder video, synthetic consent footage, false declaration of
narrow scopes being shipped, or verification submission was provided. The owner
asked to defer the video; the draft is preserved in the browser and the submission
package. Google review remains external.

The initial settings load stalled browser control; it later recovered. The request
to close that temporary tab was withdrawn. A direct PostHog connection was offered and subsequently connected by the owner.
Its authenticated metadata reads confirm the existing project, one organization
owner, enabled MFA and the two privacy transformations' enabled/disabled states. The extension file
chooser later stalled; the standard native picker uploaded the prepared website
archive. No extension file permissions were expanded and no browser cookies/session
storage were extracted through other tools. The interruption was not treated as a
successful upload; the restored Cloudflare page was inspected before proceeding.

## Remaining owner/reviewer steps, without a build or purchase

1. Google is now In production and both APIs are enabled. Provide the actual
   demonstration video and finish the prepared branding appeal/scope submission.
   The owner deferred the video and requested a reminder for November 29 at
   10:00 AM Eastern. Codex automation creation was blocked by unavailable approval.
   The owner approved a private Google Calendar fallback; its confirmed read-back
   shows the requested Eastern time, a popup at the start, and no external guests.
   Google's review and a real account outside the test list remain unverified.
2. The corrected DPA is **Signed** by the owner. Its signed copy is available in
   PostHog/PandaDoc. Do not publish the private agreement/address in Git.
3. The disposable-profile erasure request is accepted and the profile now returns
   404. Its two events remain subject to asynchronous vendor purge. Do not claim
   physical deletion is complete or issue an unnecessary duplicate delete.
4. Signed-copy download is available in PostHog/PandaDoc. A download was attempted,
   but a separate local file was not verified: the download event timed out and
   browser policy blocked opening the internal downloads manager. No alternate
   browser surface or cookie/credential extraction was used to bypass that block.

[Sanitized verified state](vendor-review-2026-11-28/verified-state.json),
[production HTTP checks](vendor-review-2026-11-28/production-http-checks.json),
[preview HTTP checks](vendor-review-2026-11-28/preview-http-checks.json), and
[artifact hashes](vendor-review-2026-11-28/artifact-manifest.json).
Screenshots stay local because they include browser context and owner contact
information. Raw EAS output was processed privately and the two task-created
output files were removed. No keys, private address or production records were
committed. The owned loopback preview server was stopped; app/persona services
were preserved.


## Direct-connector follow-up

The owner connected PostHog. Metadata-only tools confirmed SweetMate's Default
project **719267**, one organization member with owner level **15**, and enabled
MFA. Narrow function reads confirmed the location filter remains enabled and
GeoIP remains disabled. These reads changed no settings or data.

Automatic approval review rejected the full project-details operation because
it would also return a project API token. That request was not needed to finish
the checks: metadata-only membership/identity and specific privacy-function reads
were used instead. No broader credential access is requested. The owner subsequently approved Google production publication and completed the
corrected DPA signature. The owner also explicitly authorized the synthetic-profile deletion; the API
accepted it and the profile is no longer retrievable. Event purge remains pending;
the Google demo is deferred. See the
[sanitized connector evidence](vendor-review-2026-11-28/connector-verification.json).

## November 28 final follow-up

The corrected DPA is Signed; the owner performed its signature. Google audience
is In production, but the branding appeal/scope request remains unsubmitted until
the owner supplies the deferred real YouTube demo. The private Calendar reminder
was created and read back for November 29 at 10:00 AM America/New_York. The real
erasure workflow accepted the synthetic-only request; person lookup now returns
404, with final event purge still asynchronous. No purchases, native builds,
TestFlight submissions, real-user erasure or retention changes occurred.

[Sanitized erasure evidence](vendor-review-2026-11-28/erasure-test-result.json).
