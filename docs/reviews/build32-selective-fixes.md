# Build 32 selective improvements

Base: `2247dfe5cc01081a8a04f383430088bcca327e40` (TestFlight 1.0.0 build 32).
Build 33 source: `fdf50d67477cb7eafc55bad9b8def07fb2b8ea18` in the older Downloads/Homie checkout. Its history branches from the August 1 code and does not include build 32's interface work. Expo marked the build's commit with an asterisk, so the commit is not proof of every file in its uploaded working tree.

## Selected changes

- Preserve build 32's light/dark Liquid Glass design, condensed typography, animated logo, popup system, draggable tab selection, household monitor, normalized sync, and repayment actions.
- Hide the native splash after root layout; match native launch backgrounds and navigation theme to avoid blank white frames. Keep the existing animated house loader.
- Extend action-sheet surfaces to the bottom edge with safe-area content padding. Space settings link rows and protect calendar, expense-detail, and planning-footer content from bottom system bars.
- Centralize tab/FAB clearance and account for the bottom safe area on group and ranks screens.
- Add Android keyboard avoidance, hardware-back dismissal on borrow/shopping sheets, bounded ripple feedback on shared buttons, opaque glass fallback, font-padding consistency, FAB elevation, and SVG mark fill without shared gradient IDs.
- Add a read-only net IOU summary alongside existing gross balances. A zero net with unpaid individual debts explicitly says repayments remain outstanding. No debts are reassigned, settled, or automatically netted for payment.

- Follow-up: replace the dark monochrome near-white action fill with charcoal, remove browser tap highlighting, and retain a subdued visible keyboard focus ring.

## Validation

- Mobile test command, including popup, overdue display, alert-read-state, design-token and existing business-logic tests: passed.
- Added IOU tests: reciprocal debts, zero-net debt chains, repayment/settlement exclusions, cent arithmetic, invalid shares, unrelated users, and no input mutation: passed.
- Library and mobile TypeScript checks: passed.
- Production web export and iOS/Android JavaScript/Hermes exports: passed.
- Local browser preview loaded the build 32 dashboard and rendered the net IOU summary. Browser interaction timeouts limited manual click-through checks.
- Native launch, keyboard avoidance, hardware back, system bars and native glass still require a device smoke test. JavaScript exports are not an IPA/APK build.

## Review preview

Open http://127.0.0.1:8084 on this Mac while the preview server is running. This is a browser rendering of the proposed source, not the TestFlight binary. It uses the existing Preview Guest configuration and connected data; edits in the app can persist.

The reviewed source is prepared for a GitHub push and a new production iOS/TestFlight build. No production database migration is included. Release status is recorded by the GitHub commit and EAS build/submission records.
