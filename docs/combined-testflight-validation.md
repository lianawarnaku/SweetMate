# Combined TestFlight source — October 16, 2026

Canonical checkout: `/Users/lianawarnakulasooriya/Downloads/Homie2-main`.
Branch: `main`, fast-forwarded to `a2acbca` (Roha Sajid, October 12,
“working on calendar feature on MySweet page”). The remote main SHA was
verified before combining. Existing local feedback work was preserved.

## Included

- Roha’s full latest main commit, including MySweet/calendar and other changes.
- Feedback privacy, exact thank-you copy, provider-receipt validation, and safe
  failure diagnostics. Existing database, RLS, Edge Functions and email queue
  are reused; live storage and Resend acceptance were verified on October 16.
- The house transition fix adapted to v2, rather than overwriting v2 with old
  components. One SVG remains mounted during auth/data loading and moves only
  after destination layout and native splash release. It follows scrolling and
  respects reduced motion. Screens without a destination house retain their
  existing layout. The former fixed 1.2-second launch timer is removed.
- Repaired native splash: the previously configured PNG was entirely opaque
  white (all RGBA channels 255). It is now rendered from the existing house SVG
  using the existing brand color, with transparent corners. Native and React
  fades no longer overlap and produce two houses.

No unrelated Desktop checkout drafts were imported. Roha’s themed root surface,
React Navigation setup, calendar, chore, and screen changes are preserved.

## Validation

Passed on combined source:

- Workspace typecheck and full mobile regression suite, including Roha’s tests.
- Production Expo web and iOS/Hermes JavaScript exports.
- Seven feedback function tests, isolated PostgreSQL security tests, and feedback
  browser interaction tests (loading, repeat-click protection, retained draft,
  retry identity, exact confirmation, blank optional reply address).
- Real React Native Web/Reanimated/SVG house test: stationary delayed loading,
  immediate readiness, late anchor layout, intermediate animation frames,
  uninterrupted visibility, stable SVG identity, scrolling, repeat loading,
  no-house destinations, reduced motion, and a single splash handoff.
- Repaired splash alpha/geometry checks and resolved Expo native splash config.
- Private recipient and server-secret reference scans of frontend source and
  production web/iOS bundles. `git diff --check` passed.

Reproduce the focused transition checks with disposable Playwright/esbuild
packages (the harness also uses the app’s existing Babel worklet plugin):

```sh
node scripts/house-transition/test-ui.mjs /private/tmp/sweetmate-feedback-tests/node_modules
node scripts/house-transition/render-splash.mjs /private/tmp/sweetmate-feedback-tests/node_modules
```

## Release state and limits

Changes are combined locally on main. They have not been committed or pushed
to GitHub. The authorized TestFlight release below was built from this canonical
working tree, including the local fixes.
The corrected native splash requires a new native app build, not just a JS OTA
update. Full Xcode is not installed here (only Command Line Tools), so a signed
native build and actual iPhone/simulator visual verification remain outstanding.
Production iOS export verifies JavaScript/Hermes bundling, not a native archive.

## TestFlight upload — October 16, 2026

At the user’s explicit request, the combined working tree was uploaded to EAS
and built using the existing production environment and remote Apple signing
credentials. Both the native build and automatic App Store Connect submission
finished successfully.

- Version: **1.0.0 (36)**
- EAS build ID: `5af1fbe2-5fff-453c-bb56-5bc802a0056d`
- EAS submission ID: `ca4953fc-1577-40aa-93d7-83cda977f3cf`
- Source fingerprint: `d8d548e3e167b3e095c842f28e678831c73d74b2`
- App Store Connect app: `6794171916`
- [Build](https://expo.dev/accounts/lianawarnakulasooriyas-team/projects/homie/builds/5af1fbe2-5fff-453c-bb56-5bc802a0056d)
- [Submission](https://expo.dev/accounts/lianawarnakulasooriyas-team/projects/homie/submissions/ca4953fc-1577-40aa-93d7-83cda977f3cf)

The initial post-upload TestFlight status query had not listed build 36 yet.
Upload success does not establish tester availability: Apple processing and
any external-testing review/distribution steps are separate. No public App
Store release was requested or performed.
