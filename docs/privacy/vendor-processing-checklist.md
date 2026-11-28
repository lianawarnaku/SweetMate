# Telemetry vendor processing checklist

Complete this checklist before public release or enabling additional telemetry.
Source safeguards do not establish the vendor dashboard retention/access settings.

## PostHog

November 27, 2026: project 719267 (Default project) IP discarding enabled,
GeoIP paused, and `SweetMate — discard location metadata` transformation active.
Its synthetic test cleared IP, geographic person/event fields, timezone and locale.
Existing history is retained at the owner's explicit request. No retention setting
or billing plan was changed. Evidence: [location privacy report](location-privacy-2026-11-27.md).

- [x] New IP-derived location enrichment disabled
- [x] New event IP storage disabled
- [x] Incoming known geographic/device timezone/locale values filtered

- [x] One organization owner and zero pending invitations verified; owner contact retained in the private vendor account
- [x] US Cloud region verified; current DPA transfer provisions reviewed
- [ ] Complete DPA countersignature and preserve its signed copy (currently Awaiting signature)
- [x] Current DPA and subprocessors reviewed; sending an envelope is not a completed signature
- [x] Current Free plan / Organization default (1 year) retention verified without changing it; person profiles do not share that expiry
- [x] Session replay, web autocapture, web-vitals and dead-click capture confirmed off
- [x] No outbound destinations or other connected integrations configured; onboarding examples were not treated as live destinations
- [x] Production member list audited: one owner, no other members or pending invitations
- [ ] Owner completes individual MFA enrollment; paid organization-wide enforcement is not required
- [ ] Complete deletion drill: one disposable profile and two synthetic events verified; permanent-delete approval pending
- [x] Operational privacy contact support@sweetmate.info and the private vendor-owner contact recorded; complete agreement/signature notification review

## Sentry — currently inactive

November 28: official EAS production project and account-wide environment checks
found no Sentry DSN or upload credential; the reviewed app requires a DSN before
initialization and has no Sentry native plugin. See the
[verified execution record](vendor-review-2026-11-28.md). The following project
checks are **future activation gates**, not unfinished setup for an active vendor.
Do not enable Sentry or buy anything just to complete them.

- [ ] Organization/project owner recorded
- [ ] Hosting region and transfer mechanism confirmed
- [ ] DPA and current subprocessors reviewed
- [ ] Actual project retention verified before any future Sentry activation
- [ ] Replay, tracing, default PII, request bodies, and sensitive breadcrumbs disabled
- [ ] Source-map access and upload credentials restricted
- [ ] Production access limited and audited
- [ ] User/identifier deletion procedure tested
- [ ] Verify the future Sentry project's security and breach-notification contact before activation

## Expo / EAS

- [x] Existing EAS build/distribution and optional push processing documented; no direct expo-updates dependency in the reviewed source
- [x] No EAS Observe client package/configuration in reviewed source; do not infer all account dashboard settings from this
- [ ] Review data, retention and policy disclosures before enabling any additional observability service

## Erasure support queue

November 28 production aggregate: zero pending requests; RLS enabled and ordinary
clients cannot read the queue. A real PostHog dummy-identifier deletion drill is
still required; a private queue row is not proof of vendor erasure.

## Release approval

- [x] No unresolved policy placeholders in the live website; verified by rendered/static checks
- [x] Privacy contact support@sweetmate.info is monitored per owner confirmation
- [ ] Apple and Google worksheets reconciled with the shipped build
- [ ] Network inspection shows no telemetry before opt-in
- [ ] Opt-out and identity reset verified on iOS and Android
- [x] Verified retention/current-provider notice published and privacy URL publicly reachable
