# Exact black content surfaces — 2026-11-27

Prepared in the canonical `main` checkout. No production backend change, EAS/native release build, purchase, or TestFlight submission was performed. Existing uncommitted changes and Avery/Blake data were preserved.

## Diagnosis and correction

The source recorded for TestFlight 1.0.0 (54), commit `5d6bedafe91f5ed2a87a93f5ed52d7c2afdff777`, and the local source both used charcoal `#1A1A1B` cards, `#121213` subtle/task rows, and `#18181B` elevated cards/sheets over a `#070708` page. Thus the separate gray fills were present even in that released version; this was not evidence that the phone simply lacked a prior black-card fix.

The actual running Blake preview was measured before editing: chore-row fill `rgb(18,18,19)` and page fill `rgb(7,7,8)`. The preview was also near black, not exactly page black. Without a phone screenshot/device capture we cannot establish the exact displayed phone pixels, display effects, or installed app version from the user's description alone.

`constants/themeTokens.ts` now gives dark pages, regular cards, subtle/task rows, nested/elevated cards, and ordinary solid sheets the exact same opaque **#000000**, for every accent. Border, spacing, text and status treatments retain their roles. Light palette values are unchanged.

`components/LiquidGlass.tsx` uses a separate `controlSurfaceOpaque` token for the button/navigation fallback. Native glass and web blur remain available on controls; reducing transparency and Android still receive the previous readable opaque control fill. Ordinary content does not use native glass or blur. Warning/destructive accents and input/control affordances remain intentional treatments.

## Verification

- Workspace `pnpm run typecheck`: passed.
- Full mobile suite: **112/112 test programs passed**.
- Extended actual-component rendering tests enforce exact black page/card equality on iOS (native glass available/unavailable), Android and web, with reduced transparency on/off. All dark accents are covered; existing light rendering and caller background overrides are retained. Native rendering is modeled, not an installed-phone test.
- Local Expo exports for web, iOS and Android: passed. These are JavaScript bundle exports, not distributable native builds.
- Rebuilt the existing local persona browser assets from canonical source, preserving accounts, sessions and household records.
- At 390 × 844 in the actual browser, task rows, settings cards and expense-list cards measured **rgb(0,0,0)**, matching the page. Viewport and document width were both 390px. Cards retain their borders; button/navigation glass remains visually distinct.
- No app records were created, completed, deleted, or reassigned in this visual check. Temporary browser tab was closed and the viewport override reset; the original persona launcher and local services remain available.

Evidence: [My Sweet](black-content-surfaces-2026-11-27/my-sweet.jpg), [Settings](black-content-surfaces-2026-11-27/settings.jpg), [Expenses](black-content-surfaces-2026-11-27/expenses.jpg), [check summary](black-content-surfaces-2026-11-27/checks.txt).

## Delivery boundary

The phone's installed release has not changed. This fix must be included in a separately authorized SweetMate app release to reach TestFlight users; updating the Expo tooling alone does not replace an already installed app's bundled styles. No OTA update was published. Physical iPhone appearance, native glass, accessibility display settings and native popup presentation still need validation on that release. A browser screenshot cannot certify the phone's display.
