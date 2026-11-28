# Android compatibility check — November 27, 2026

Canonical `main` was checked with its existing uncommitted reliability fixes
preserved. The owner then clarified that Android does not need push notifications,
GPS/location access, or microphone access. No purchase, EAS cloud build, signed
APK/AAB build, TestFlight build, Google Play upload, or production deployment ran.

## Result

The shared app code passes the available Android compilation/configuration checks.
This is **not yet certification of an installed Android application**. This Mac
has Java installed, but no accessible Android SDK, emulator, or adb executable;
no physical Android device or emulator was used. No Android APK/AAB was produced.

The native dependency baseline is Android API 24 (Android 7+) with compile/target
API 36. This is the configured baseline, not evidence that every supported phone,
OS version, browser, or manufacturer has been tested.

## Changes requested during this check

- Android's blocked permissions now include coarse/fine/background location,
  microphone recording, and `POST_NOTIFICATIONS`. The existing block on Android
  calendar read/write remains. Cloud Google Calendar/Tasks access uses OAuth,
  not Android's local calendar permission.
- Android no longer installs the push foreground handler, requests notification
  permission, obtains Expo/FCM tokens, creates a push channel, registers push
  devices, or installs background-push response/token listeners.
- On Android sign-in, the existing installation is unregistered if one was saved
  by an older build. Cleanup failure is contained and logged. Offline cleanup
  cannot promise immediate cancellation of a previously registered server token.
- In-app nudges and alerts remain mounted through the shared app. A subsequent
  November 27 privacy change makes the manual statuses Available/sleeping/do-not-disturb,
  with no physical-presence meaning, removes the unused GPS dependency and coordinate
  state, and changes App Store Shared Location to No for the next app version.
  See [the location privacy report](../privacy/location-privacy-2026-11-27.md).
- iOS push behavior remains enabled. The test exercises granted/denied permission,
  first permission request, registration, foreground refresh, simulator exclusion,
  and listener cleanup. This is a runtime regression test with substituted native
  modules, not an on-device APNs delivery test.

Files: `artifacts/mobile/app.json`,
`artifacts/mobile/components/PushNotificationManager.native.tsx`,
`artifacts/mobile/components/PushNotificationManager.tsx`, and the new
`artifacts/mobile/lib/pushPlatformPolicy.test.ts`.

Firebase credentials are **not a prerequisite for the requested Android scope**,
since Android background push is now intentionally disabled. No Firebase account
or credentials were created or changed.

## What differs from iPhone

| Area | Android behavior |
| --- | --- |
| Household, chore, expense, shopping and borrowing data | Same shared React Native feature code and Supabase project. Android/iPhone users can participate in the same household; there is no separate Android database or planned data migration. Installed-device persistence/sync still needs its smoke test. |
| Email/Google/Apple sign-in | Same email/password and browser OAuth implementation. Android uses the system browser/Custom Tabs for OAuth and returns through `sweetmate://auth/callback`. The generated native intent filter contains `sweetmate`, with a single-task launch activity. Real Android browser return/cancellation remains unverified. |
| Google Calendar and Tasks | Same authenticated server integration and per-household schedule preferences. The Android export branch was executed with a substituted transport. Live OAuth/import/sync must still be checked on a phone. |
| Apple Reminders | Explicitly unsupported on Android. The destination picker offers Google Calendar there; it does not call Apple Reminders APIs or substitute an unwanted local calendar event. |
| Glass and buttons | General cards/sheets remain solid. Android button/navigation surfaces use the existing opaque fallback instead of Apple's native Liquid Glass. Android ripple feedback and accent colors remain. |
| Completion feedback | Shared completion animation and haptics code remains. VIBRATE stays allowed. Actual vibration strength, smoothness and battery/manufacturer effects require device testing. |
| Keyboards and navigation | Android-specific keyboard avoidance selects height; tab/FAB clearance uses safe-area insets; common modals have Back-button dismissal; Android modal handoff is covered by the existing regression. Native edge-to-edge/system bars and gesture versus three-button navigation remain unverified visually. |
| Notifications | In-app nudges/alerts only on Android; iOS background push remains enabled. |

## Checks performed

1. **Android JavaScript/Hermes export: passed**, including a fresh export after
   the requested changes. The final Android bytecode bundle is about 9.2 MB;
   that is not the installed app/APK size.
2. **Android native config generation: passed**, using Expo's official template
   in an isolated temporary metadata/assets copy, with no dependency install.
   It did not modify/create a canonical `android/` directory. This generated
   Gradle/config files; it did not compile Java, Kotlin, C++, or produce a binary.
3. **Generated manifest inspection: passed**. All seven blocked permissions have
   `tools:node="remove"`, including POST_NOTIFICATIONS, location, microphone and
   local calendar permissions. The OAuth scheme, portrait activity, adjustResize,
   adaptive icon, Hermes and edge-to-edge settings are present. A fully merged
   packaged manifest still needs inspection after the first native APK build.
4. **Workspace typecheck: passed. Mobile suite: 98/98 programs passed.** These
   are controlled logic/provider/component checks, not 98 Android device tests.
5. **Additional controlled Android execution: passed**: actual external-task code
   permits Google export, rejects Apple Reminders before invoking native APIs,
   and restores the saved destination; actual keyboard behavior selects height.
   The existing full home-screen harness was also executed with its Platform
   changed to Android, covering attached-calendar/summary transitions, saved
   dismissal, household switching and stable complete/undo progress. Native
   rendering, dimensions, lifecycle and gestures remain substituted in that harness.
6. **Existing integration runtime suite: passed**, using substituted external
   providers for push retries/receipts and Calendar identity/scope/expiry/replay.
7. **Expo dependency check: passed online in check-only mode**, without upgrades
   or installs. An earlier offline attempt warned that offline validation was
   unreliable, so it was not the final dependency evidence.
8. **iOS JavaScript/Hermes export: passed** after the Android policy change.
9. **git diff --check: passed.** No source commit or push was requested/performed.

A first temporary Android home-screen harness attempted to import TypeScript
through a JavaScript data URL and failed on type syntax. Transpiling that harness
before execution corrected the test setup; it was not an application defect.
The existing Android adaptive foreground was also inspected: it is dark house
artwork on transparency over the configured white background, not a blank icon.

Raw logs, isolated generated project, bytecode exports and the additional runtime
script remain in `/tmp/sweetmate-android-audit-2026-11-27`. Test exports use local
QA placeholder settings, with telemetry/vendor keys blank. They are not installable
production artifacts. No real user records or Google grants were changed.

## Remaining installed-phone check

Prepare a private Android APK with an Android SDK/toolchain, then exercise cold
launch and return; email/Google/Apple login and cancellation; Google connection;
household creation/switching; mixed Android/iPhone chart approval; calendar-header
scroll/dismissal; typing/date pickers; list/item save/delete/retry; borrowing;
expenses; profile photos; account deletion; and in-app nudges. Check both gesture
and three-button navigation, hardware Back, keyboard, large text/TalkBack and
completion feedback. Confirm no microphone/location/notification permission prompt.
Android background push is intentionally out of scope. Public Google OAuth
publication/verification remains a separate requirement for unrestricted access.

No Android production signing or Google Play distribution setup was certified by
this audit. A successful JavaScript export and prebuild cannot replace native
compilation, installation, actual OAuth return, or physical UI testing.

## Primary references checked

- [Expo SDK 57 glass effect support](https://docs.expo.dev/versions/v57.0.0/sdk/glass-effect/)
- [Expo SDK 57 browser/OAuth behavior](https://docs.expo.dev/versions/v57.0.0/sdk/webbrowser/)
- [Expo Android APK development builds](https://docs.expo.dev/tutorial/eas/android-development-build/)
- [Expo local development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [FCM setup, applicable only if Android push is reintroduced](https://docs.expo.dev/push-notifications/fcm-credentials/)
