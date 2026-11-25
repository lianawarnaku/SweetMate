# SweetMate TestFlight 1.0.0 (50)

Release date: November 25, 2026.

## Source and build

- Branch: `main` in the canonical `Downloads/Homie2-main` checkout.
- App source: `535734a386923ccd387b0493219f876a340739bd`, pushed to GitHub main before the build.
- Bundle identifier: `com.homieapplication.homie`.
- EAS build: [70e340fa-a4f7-4d1d-8a13-110488faab1f](https://expo.dev/accounts/lianawarnakulasooriyas-team/projects/homie/builds/70e340fa-a4f7-4d1d-8a13-110488faab1f).
- Production environment and signing credentials; remote build number incremented from 49 to 50.
- The owner explicitly requested this build, ending the earlier hold on new TestFlight builds.

## Changes to test

- Every imported Google event and task opens details inside SweetMate and supports local completion/undo. White checkbox rings show elapsed time for timed blocks and fill fully when checked; untimed items fill only when checked. Local event checkmarks survive subsequent sync.
- My Sweet uses Day and Night labels, hides the Google schedule manager after connection, clears the caught-up state when items become incomplete, and includes the mini house beside the welcome greeting.
- Calendar dismissal also completes when a native animation is interrupted.
- Tasks, lists, calendars, content cards and sheets use solid fills. Floating button/navigation controls retain glass. Filter buttons follow the selected theme and draw their rounded outlines above the glass/tint layers.
- Shopping list naming is editable; optional planned dates/times appear in the Group calendar.
- Completed household details start collapsed below Your Profile in Settings. Incomplete setups retain the expanded section above the profile. Incomplete planning remains prioritized.
- Settings has a larger household title. Removed the requested Random Task, Calendar rotation, and New IOU subtitles.

## Validation

- `pnpm run typecheck`: passed for the exact app source.
- `pnpm --filter @workspace/mobile run test`: passed, including imported-item interactions and native/fallback surface behavior.
- Production iOS Hermes export: passed. Checked the actual export for the production Supabase host, imported-item completion/details and Day/Night copy; no local QA URL, QA key placeholder, Google client secret prefix or removed subtitles were present.
- Google schedule and backend integration runtime tests: passed.
- Disposable PostgreSQL replay: all 56 migrations passed, including fresh/legacy schema paths, role permissions and record isolation; personal schedule privacy and event completion/undo/sync regressions passed.
- Production schema verification: event completion migration installed; owner-only execution, anonymous denial and direct-write restrictions preserved. Database migration dry run reports up to date.
- Local browser review: filter buttons remained rounded in selected/unselected My Sweet and Group states; household details opened and collapsed below the profile after completed setup.
- No real Google events, household members, chores or other user records were changed to validate this release. Native iPhone interaction testing remains for the owner after updating.

## Backend

- Production project: `eqnogaftebuqfwwelbdx`.
- `202611250001_personal_event_completion.sql` was already deployed and independently verified before this release. It changes the existing owner-authorized RPC without altering saved data.
- Google Calendar sign-in retains the working server client configuration confirmed by the owner on November 25. This build does not change OAuth audience or Google account access.

## TestFlight distribution

- Submission: [63cbeb23-1293-4617-bca5-ac7fe045b35c](https://expo.dev/accounts/lianawarnakulasooriyas-team/projects/homie/submissions/63cbeb23-1293-4617-bca5-ac7fe045b35c), finished successfully.
- Submitted to the existing internal group **Sweet Mates!**.
- App Store Connect verified `processingState: VALID`, `internalState: IN_BETA_TESTING`, `expired: false` for **1.0.0 (50)**.
- Apple upload timestamp: 2026-11-25T21:12:07.000Z.
- Apple reports the exact EAS build and submission IDs above; native fingerprint `69fb204edf13921f23dc1aab67a76872651edc3f` matches the finished EAS build.
- External state: `READY_FOR_BETA_SUBMISSION`. No external beta review or public App Store release was initiated.
- [Open TestFlight in App Store Connect](https://appstoreconnect.apple.com/apps/6794171916/testflight/ios).
- Testers can update SweetMate to **1.0.0 (50)** in TestFlight.

