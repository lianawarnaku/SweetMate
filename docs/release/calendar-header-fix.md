# My Sweet calendar header correction

Prepared on canonical `main` on November 26, 2026. The owner confirmed the
reported iPhone issue occurs in TestFlight **1.0.0 (52)**. No new native build,
submission, or distribution was started for this correction.

The previous X handler faded its summary first and changed the parent calendar
layout only after a native animation callback or a fallback timer. This allowed
the visible dismissal and the calendar's layout transition to be separate events.
The correction commits the layout directly in the X handler. The small jiggle,
fade, and haptic remain feedback; they cannot gate the layout change.

The attached week now uses a plain, full-width native header view with the same
background as the screen, rather than restyling a card surface. Its old Calendar
divider and inline card subtree are replaced using a new native section identity.
Non-flattened native containers preserve the intended hierarchy. A temporarily
unavailable household/storage key no longer vetoes the visible dismissal.
Existing day/account/household persistence and reduced-motion behavior remain.
The explicit month view still opens normally and returns to the attached week.

## Checks

- Regression reproduces the old X handler waiting for native callbacks/timers,
  and passes with the corrected immediate commit. It covers interrupted/missing
  callbacks, repeated taps, and reduced motion.
- Executed native-host presentation tests verify divider removal, replacement
  section identity, no card surface/border/corners, preservation of calendar
  controls, and dismissed behavior even when the old section was collapsed.
- Dismissal storage tests cover remounts, account/day/household changes, late reads,
  failed writes, and unavailable session/storage scope.
- Workspace typecheck and complete mobile test suite passed.
- iOS JavaScript/Hermes export and QA web export passed.
- At 390 × 844 in an isolated fictional local household, X immediately left
  zero Calendar headings, zero inline calendar cards, and one attached week.
  The header measured 390 px wide at x=0, with 0 px border and corner radius.
- Scroll verification observed 14 distinct hiding transforms ending at -174 px,
  and 10 restoring transforms ending at 0 px. The calendar ignores touches while
  hidden. Month/week controls and persistence after reload also passed, with no
  browser console errors.
- The canonical Avery/Blake preview assets were updated without resetting data.

Native-host tests substitute platform rendering and animation scheduling. They
are not an on-device reproduction. Validate the complete flow on the next
explicitly authorized native iPhone build, including reduced motion and returning
from the background. Build 52 cannot receive these local source changes without
a subsequent native release.
