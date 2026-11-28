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

- [ ] Organization/project owner recorded
- [ ] Hosting region and transfer mechanism confirmed
- [ ] DPA and current subprocessors reviewed
- [ ] Retention set to [ANALYTICS RETENTION PERIOD]
- [ ] Session replay and autocapture confirmed disabled
- [ ] Advertising profiles and integrations disabled
- [ ] Production access limited and audited
- [ ] User/identifier deletion procedure tested
- [ ] Security and breach notification contacts recorded

## Sentry

- [ ] Organization/project owner recorded
- [ ] Hosting region and transfer mechanism confirmed
- [ ] DPA and current subprocessors reviewed
- [ ] Retention set to [ANALYTICS RETENTION PERIOD]
- [ ] Replay, tracing, default PII, request bodies, and sensitive breadcrumbs disabled
- [ ] Source-map access and upload credentials restricted
- [ ] Production access limited and audited
- [ ] User/identifier deletion procedure tested
- [ ] Security and breach notification contacts recorded

## Expo / EAS

- [ ] Existing delivery/update processing documented
- [ ] Confirm EAS Observe is disabled in the production project; the current SDK 57 alone does not establish vendor settings
- [ ] Review data, retention and policy disclosures before enabling any additional observability service

## Release approval

- [ ] All bracketed policy fields replaced
- [ ] Privacy contact is monitored
- [ ] Apple and Google worksheets reconciled with the shipped build
- [ ] Network inspection shows no telemetry before opt-in
- [ ] Opt-out and identity reset verified on iOS and Android
- [ ] Material notice reviewed and privacy-policy URL reachable
