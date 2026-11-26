# iOS 27 SDK preparation

Prepared on canonical `main` on November 26, 2026. This change has not been
compiled into a native archive, uploaded, or distributed. Build 52 remains the
existing TestFlight release. The standing requirement for an explicit request
before another TestFlight release still applies.

Apple requires the iOS/iPadOS 27 SDK or newer for uploads starting April 2027.
The warning on the already uploaded iOS 26 build cannot be removed by changing
source or server settings; a newly compiled and uploaded archive is required.
See [Apple's submission requirements](https://developer.apple.com/app-store/submitting/).

## Prepared configuration

- Production EAS iOS image: `macos-tahoe-26.6-xcode-27.2`, from Expo's
  [published build images](https://docs.expo.dev/build-reference/infrastructure/).
- Expo `57.0.34`, React Native `0.86.3`, React `19.2.3`, with their matching
  native modules and lockfile. TypeScript is aligned to `6.0.3`.
- `expo-build-properties` `57.0.24` enables `ios.enableSceneSupport`.
  SDK 57 needs this explicit opt-in to launch correctly when built with Xcode 27.
  See [Expo's supported SDK 57 scene migration](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md#staying-on-sdk-57-with-xcode-27).
- Minimum supported device OS is now **iOS 16.4**. This is distinct from the
  compiler SDK version; users do not need iOS 27 merely because the app is built
  with its SDK.
- Bundle identifier, URL scheme, EAS project, app version, backend, and auth
  storage keys are preserved. There are no database migrations or data resets.
- Navigation imports now use Expo Router's supported entry points. Reminders
  uses the retained `expo-calendar/legacy` API. Removed Android navigation-bar
  configuration is replaced by its supported plugin, and deprecated
  `StyleSheet.absoluteFillObject` usages use `StyleSheet.absoluteFill`.
- CommonJS runtime test fixtures explicitly retain their previous import
  interop behavior under TypeScript 6. No assertions were removed.

SDK 57 was selected instead of SDK 58 because it has a documented Xcode 27
migration and avoids adopting React Native 0.88.1 while its confirmed iOS
renderer teardown crash awaits a released fix. See the
[Expo maintainer's explanation](https://github.com/expo/expo/issues/54200).
Reassess that tradeoff during a future framework upgrade.

## Verification completed

- `pnpm run typecheck`.
- `pnpm --filter @workspace/mobile run test`, including the earlier schedule,
  completion-feedback, and random-task fixes already in the working tree.
- Expo Doctor: **21/21 checks passed**.
- Production iOS JavaScript/Hermes export and local QA web export.
- Isolated native generation using the canonical app configuration. Verified
  `EXExpoAppSceneDelegate`, factory-provider conformance, scene-owned startup,
  deployment target 16.4, the existing bundle identifier, and the `sweetmate`
  callback URL scheme. The installed Expo runtime implements the delegate and
  forwards URL and user-activity callbacks.
- Browser smoke test with an isolated fictional local household: session
  restoration, My Sweet, Group, Expenses, Shopping, Borrow, Settings, and return
  navigation. No browser console errors were recorded.

## Next authorized native release

1. Build with the production profile and confirm the build log selects Xcode
   27.2. Inspect the archive's `DTSDKName`/`DTXcode` values; the iPhone SDK must be
   27 or newer. Source configuration alone does not verify a compiled archive.
2. Test cold launch and return from background on iOS 27 and an older supported
   iOS version. Check Google/Apple sign-in, Google Calendar connection and return
   callbacks, push notification routing, Reminders export, keyboard entry,
   navigation, and glass controls on a device.
3. Upload only after the owner requests the release, then confirm App Store
   Connect processes the new archive without the old SDK warning.

Native compilation and device tests remain outstanding. The active local
`xcode-select` directory points to Command Line Tools, so the preparation checks
did not run a local Xcode archive or simulator build.

## Native verification — November 26, 2026

The separately authorized [TestFlight build 54](testflight-54.md) finished native
compilation. Its signed IPA reports `DTSDKName=iphoneos27.2`, `DTXcode=2720`,
minimum iOS 16.4, a configured UIKit scene lifecycle and the SweetMate callback
scheme. Physical-device validation remains outstanding.
