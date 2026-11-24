# SweetMate TestFlight 1.0.0 (48)

Release date: November 24, 2026.

## Source and build

- Branch: `main` in the canonical `Downloads/Homie2-main` checkout.
- Feature commit: `1608660`.
- Build source: `34414492a106cdc638c218261ca108144f95b684`, including the latest upstream authentication, chore-entry, web input, and privacy-page fixes.
- Bundle identifier: `com.homieapplication.homie`.
- EAS build: [27be6983-7373-49e6-9426-036a9b4e57d8](https://expo.dev/accounts/lianawarnakulasooriyas-team/projects/homie/builds/27be6983-7373-49e6-9426-036a9b4e57d8).
- Production build profile and remote build numbering; native build completed successfully.

## Changes to test

- Resume or edit household setup without losing roommates and saved records; updated setup and chart-completion controls in Settings.
- Review generated tasks, frequency and difficulty, all visible preference-slider positions, average weekly workload, rotation previews, and optional permanent task preferences.
- Full-screen chart review, every member's approval state, approval confirmation, fresh pending votes after restart, and restart alerts for other members.
- Approved chores appear with saved due dates. My Sweet includes personal Upcoming chores; Group's list and progress monitor cover only the current household week, while its Calendar retains future dates.
- Group random tasks support claiming for 24 hours or random assignment, with a due date 24 hours after assignment.
- Selected Google calendars and Tasks lists sync privately into Morning and Night. Active blocks show timers; optional household sharing reveals only Busy and its end time. Task checkmarks and time overrides stay in SweetMate.
- Glass action controls, filters, bottom navigation and calendar; reduced-transparency fallback, white toggles, quieter empty states, and assigned-shopping visibility.
- Optional signup analytics/crash-reporting checkbox with Privacy Policy link; provider sign-in concurrency and missing-session protections retained from upstream.

## Validation

- `pnpm run typecheck`: passed.
- `pnpm --filter @workspace/mobile run test`: passed, including the upstream Apple/Google callback and auth-session suites.
- iOS Expo export with Hermes: passed.
- Google schedule and backend integration runtime suites: passed.
- Five local PostgreSQL rollback suites passed: chart restart, random tasks, personal schedule privacy, unchanged chore updates, and replacement chore anchors.
- Existing browser checks covered the Avery/Blake chart and weekly Group/Calendar behavior before the merge. No native device sign-in, Google consent, push-delivery, or personal-data import was performed during this release.

## Backend rollout

- Production project: `eqnogaftebuqfwwelbdx`.
- Applied ten pending migrations, from `202611220001` through `202611240007`.
- Deployed `calendar` and `google-schedule` Edge Functions, retaining the existing Google OAuth credentials.
- Configured a new private worker credential in Edge secrets and Vault. Calendar sync runs every five minutes; random-task expiry runs every minute.
- Verified all five new tables have RLS, schedule worker RPCs remain service-only, owner RPC grants are present, and restart alerts are included in the deployed procedure.
- Unauthenticated requests to Calendar connection and schedule source/sync/worker endpoints returned 401.
- Took private schema/data backups before deployment. Compared all 68 pre-existing data tables afterward: every table's row count and sorted-row SHA-256 fingerprint was unchanged. Production retained 16 accounts, 15 households, 18 memberships, 655 chores and 173 completed chores.
- Supabase reported a nonblocking pg-delta catalog-cache certificate-file warning after applying migrations. The deployment exited successfully and a separate query confirmed migration `202611240007` is installed.
- Temporary plaintext worker credential files were removed after verifying the Edge/Vault digest match. No credentials are included in Git or the mobile bundle.

## TestFlight distribution

- Submission: [0ebd9ccb-e4a7-4215-bd22-f62a84e7a875](https://expo.dev/accounts/lianawarnakulasooriyas-team/projects/homie/submissions/0ebd9ccb-e4a7-4215-bd22-f62a84e7a875), completed successfully.
- Distributed to the existing internal group **Sweet Mates!**.
- App Store Connect verification at approximately 21:46 UTC on November 24: `processingState: VALID`, `internalState: IN_BETA_TESTING`, `expired: false`.
- Apple upload timestamp: November 24, 2026, 21:42:36 UTC.
- Native fingerprint: `eece555dc90376d17a473505a4bf8b2bc45330a6`.
- External testing state: `READY_FOR_BETA_SUBMISSION`. No external beta review or public App Store submission was initiated.
- [Open TestFlight in App Store Connect](https://appstoreconnect.apple.com/apps/6794171916/testflight/ios).
- Testers can open TestFlight and update SweetMate to **1.0.0 (48)**. The feature checklist above supplies release test guidance; Expo's plan-restricted changelog flag was omitted from the successful submission.
