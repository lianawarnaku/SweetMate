# SweetMate location privacy — November 27, 2026

Owner request: stop location tracking/collection, including PostHog, and correct
App Store Connect. The owner explicitly chose to **keep historical analytics**.
No historical events, people or app records were deleted. No purchases, billing
changes, commits, production app deployment or TestFlight builds were made.

## Applied now to the existing PostHog project

Verified organization **SweetMate**, project **Default project / 719267**.

- **Discard client IP data: on**, with a success notification.
- **GeoIP transformation: Paused**, saved successfully.
- **SweetMate — discard location metadata: Active**, applied to all incoming
  events without an event matcher. It uses PostHog's Filter Properties template
  to clear known IP, geographic, timezone and locale values, including ordinary,
  `$geoip_*`, `$initial_geoip_*`, `$set` and `$set_once` paths. New fields are set
  to null; this does not rewrite historical analytics.
- A synthetic function test, containing only fake identifiers and test values,
  succeeded. IP, city, timezone, locale, nested geographic person properties and
  initial country values became null while the non-location app version remained.
  This used the function-testing tool, not a real user's calendar or telemetry.
- No retention policy or existing history was changed. Previously stored
  geographic information can still be visible in old events/person profiles.

These server changes apply to incoming analytics from existing installations,
including TestFlight 54. They do not require an app build. Incoming requests
necessarily reveal a transport IP to network infrastructure. This work disables
PostHog event-IP storage and geographic enrichment; it is not a claim that all
hosting/security logs at every service have been audited or erased.

![GeoIP paused and the incoming privacy filter active](location-privacy-2026-11-27/posthog-location-protection.jpg)

## Prepared in canonical main for a later authorized app release

- `analytics.ts`: `disableGeoip: true`, no device timezone/locale app properties,
  and a recursive `before_send` sanitizer covering event and person properties.
  It also enforces `$geoip_disable: true` after sanitization. Existing opt-in,
  opt-out, account isolation, event metrics and session-replay protections remain.
- Removed unused `expo-location` from the mobile manifest and lockfile. Source
  had no GPS request/read/watch calls; no location feature is being replaced with
  a different tracking service.
- Removed the unused `HomeLocation` coordinate state/setter/restoration and future
  cache/payload persistence. The outgoing household payload also ignores an old
  `homeLocation` field. No database/history purge was run.
- Manual roommate status semantics are **Available / sleeping / do not disturb**.
  The accessibility label no longer says Home. Legacy internal enum strings are
  retained to preserve saved household compatibility; they no longer represent
  physical presence. Google Busy sharing remains a time-only schedule signal.
- Google event location fields are not imported into SweetMate schedule records.

Existing installed apps keep their old binary and labels until a future build.
No native release was authorized or produced by this task.

## App Store Connect

App **6794171916 / SweetMate**:

- Saved **Age Ratings → Shared Location: No**. Reloaded App Information and reopened
  the questionnaire; No remained selected. The rest of the answers were preserved.
- Inspected **App Privacy → Data Types**: **Precise Location** and **Coarse Location**
  were already unchecked. No unrelated data collection declaration was removed,
  and no unnecessary unchanged privacy publication was submitted.
- App Information says these metadata changes release with the next app version.
  No app review submission, release or new build was started.

![Saved Shared Location answer set to No](location-privacy-2026-11-27/apple-shared-location-no-saved.jpg)

## Policy and verification

Updated the prepared policy at `homie-web/app/privacy/page.tsx` and the Apple,
Google Play and vendor worksheets. The policy explains current PostHog settings,
retained history, no GPS, manual availability, excluded Google event locations,
and the distinction between location analytics and operational network processing.
**This policy source has not been published**: the previously identified legacy
website publishing-access issue remains unresolved.

Checks completed:

- Required workspace typecheck: passed.
- Full mobile suite: **98/98 programs passed**, including actual analytics hook
  execution with synthetic location data and legacy coordinate payload rejection.
- Fresh local web, iOS/Hermes and Android/Hermes exports: passed, using dummy local
  backend configuration and no telemetry keys. These are bundle/config checks,
  not installed-device tests or native release archives.
- Generated native configuration inspection: 36 iOS Info.plist fields inspected;
  no location purpose strings or background location mode. Location package/plugin
  is absent; Android location permissions remain blocked.
- Updated policy TSX syntax validation and `git diff --check`: passed.
- Full website build/render tests could not start: `vinext` is not installed in
  this website checkout. Its existing render tests also target the old starter
  skeleton rather than the current SweetMate site; they need a separate update.
- No live traffic packet capture, production-user event inspection, physical
  iPhone/Android test, vendor-wide log audit or historical deletion was performed.

Raw local logs/exports are in `/tmp/sweetmate-location-privacy-2026-11-27`.
The broader [security action plan](../security/security-action-plan-2026-11-27.md)
is prepared for review; its other changes have not been implemented.

References: [PostHog React Native options](https://posthog.com/docs/libraries/react-native),
[PostHog IP storage and GeoIP distinction](https://posthog.com/docs/privacy/data-storage),
[Apple App Privacy definitions](https://developer.apple.com/app-store/app-privacy-details/).
