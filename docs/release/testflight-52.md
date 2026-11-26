# SweetMate TestFlight 1.0.0 (52)

Released November 25, 2026 (America/New_York). The owner explicitly requested
this external release after stopping build 51. The standing release hold still
applies to subsequent builds and submissions.

## Source and validation

- Canonical main source: `5fcaba56d9d04bdc15c813e15861a467143d5059`.
- Includes the attached, scrolling My Sweet week calendar and dismissal fixes,
  plus Google schedule progress rings aligned to the checkbox border.
- Typecheck and mobile tests passed for the release source. The production iOS
  Hermes export also passed before the native build.
- EAS production build: `284425c5-a47e-426a-81e3-efbc54cd4103` (FINISHED).
- EAS submission: `a1e5c7d0-0595-47f5-96d8-14ffcef0156b` (FINISHED).
- Fingerprint: `75986dcbec88a7643311284b2c737dd91e15ce06`.
- Apple app: `6794171916`; bundle: `com.homieapplication.homie`.
- Apple build: `b30c45e5-cfc6-4eeb-bf81-b47531143578`.

## External availability

Verified twice through App Store Connect, most recently November 26 at
00:00:15 UTC (November 25 at 7:00 PM Eastern):

- Processing: `VALID`; internal and external state: `IN_BETA_TESTING`.
- Beta review: `APPROVED`.
- Build 52 belongs to the existing external group `Sweet mate Tester`.
- Automatic tester notifications are enabled. Notification delivery itself was
  not checked on a tester device.
- Existing public link remains enabled: https://testflight.apple.com/join/Ee5PRBzr
- The existing group has no custom public-link tester cap enabled; Apple's
  platform capacity and device eligibility still apply.
- Public What to Test instructions were saved for en-US.

This is external TestFlight distribution, not an App Store public release.
Build 51 remained canceled and was not submitted.

## Review access

The owner authorized creating a dedicated ordinary review account and isolated
fictional household. Password login, two synthetic memberships, completed
household setup and three sample chores were verified. No existing household
or real user's Google Calendar data was used.

The owner separately approved sending the primary review login and dummy-household
instructions to Apple's private beta-review fields. Those fields were saved and
verified while preserving existing contact details. Credentials remain outside
the repository and are not included in public tester notes or this record.

## Analytics explanation checked during release

The current code uses opt-in PostHog events with a per-account, per-device random
identifier. Signup defaults both optional telemetry choices off; Settings allows
separate product analytics and crash-reporting choices. Consent is stored locally.
PostHog production configuration is present and points to its US service.
No production `EXPO_PUBLIC_SENTRY_DSN` variable is configured, so the current
crash-reporting integration is inactive.

Product events describe app/screen use, active time, onboarding steps, selected
feature actions, count buckets, coarse failures and performance duration buckets.
The installed PostHog SDK also adds app/device/OS, language/timezone, screen-size,
session and SDK metadata. IP-derived approximate location is not disabled in code;
project-side settings and actual event delivery were not inspected. Session replay
and automatic lifecycle capture are disabled; screens are tracked through an
allowlist. The event schema excludes household content, emails, names, invite
codes, expense amounts and Calendar event/task text. Existing vendor records are
not erased by switching consent off or deleting the local analytics identity.
Vendor retention and erasure settings need their own dashboard check.

## Google Calendar reminder

Apple's external approval does not publish or verify Google's separate OAuth app.
The owner was reminded of the existing public-release checklist in
[website-and-google-verification.md](website-and-google-verification.md).
No Google OAuth audience or verification settings were changed for this release.
