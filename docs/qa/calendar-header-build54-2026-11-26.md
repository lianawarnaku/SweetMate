# Calendar header still missing in build 54 — November 26, 2026

The owner reported that dismissing the My Sweet summary in TestFlight 1.0.0 (54)
removes the notification but leaves the horizontal Calendar divider and calendar
card beneath it. The same symptom had previously been reported on earlier builds.
Their follow-up confirmed that visible result; whether the remaining divider was
still interactive was not established.

## What is confirmed

This is not explained by the earlier fix simply being absent from build 54.
The retained signed IPA was opened and its embedded main.jsbundle checked. It
contains home-attached-calendar-body, home-calendar-card, attached-calendar-slot,
inline-calendar-section, Dismiss caught-up summary and the dismissal storage key.
The documented release source also contains the corrected presentation components.

A full home-screen fixture uncovered a separate, reproducible state mismatch in
that shipped source: usePinchListView can restore a saved compact/list preference,
which suppresses My Progress, but floatingWeekCalendar and divider removal used
only focusDismissed. The screen can therefore have no summary while retaining the
old Calendar bar and card. Fresh persona defaults did not exercise this path.
The pre-change fixture fails with “a saved compact layout must not leave the
horizontal Calendar bar/card active.” This reproduces a matching visible state;
it does not establish that the owner's phone had compact mode enabled.

The previous native-layout workaround replaced an inner calendar View while the
parent Reanimated FlatList and its native header cell retained their identity.
That is another native-only retention path to remove. The fixture establishes
that the old parent identity was reused; it does not reproduce an iOS rendering
engine failure. Native retention remains a hypothesis for the exact post-X phone
symptom, rather than a confirmed root cause.

## Correction

- One calendarHeaderMode now governs summary visibility, divider/card presentation,
  the floating week, and scroll restoration. Both explicit X dismissal and saved
  compact mode select the header.
- The list identity includes the account/household/day scope and calendar mode.
  Crossing into header mode replaces the entire native list/header cell, removing
  reliance on updating a retained inner calendar subtree. Ordinary list updates
  keep the same identity. The deliberate transition already reset scrolling to top.
- Calendar controls, month/week expansion, saved day/account/household preferences,
  reduced motion, the slower scroll-away timing, and completion feedback remain.

## Verification and limits

homeCalendarScreen.test.ts executes the actual MyChoresScreen with the actual
summary-dismissal and saved pinch-preference hooks. Native hosts, gestures,
animation scheduling, other data providers and unrelated helpers are substituted.
It checks the X transition, native parent identity change, saved compact mode,
cold-launch dismissal, reduced motion and household switching. Existing calendar
hook/presentation tests still cover scroll direction, spacing and interruption.
The earlier source-text assertion for list mode was removed in favor of these
screen-level behaviors.

Workspace typecheck and the complete mobile suite passed. Local Expo web,
iOS/Hermes and Android/Hermes exports passed. These are compilation checks, not
native-device rendering checks. No Xcode/iOS simulator is installed on this Mac
(simctl is unavailable), and the owner's iPhone cannot be controlled here.

Live local QA uses only disposable Audit Avery in Interaction Audit Home. In a
fresh browser origin, the Calendar was collapsed before pressing the summary X.
After X there was one attached week, zero Calendar headings, and zero old calendar
cards. Its visible top was 135 px, immediately beneath the desktop greeting area.
Keyboard scrolling down moved it to translateY=-174 with pointer events disabled;
upward scrolling restored it. Reloading kept the header and did not restore the
old divider/card. The observed viewport was desktop-sized; this is not an iPhone
layout or native animation claim. Proof and logs: /tmp/sweetmate-calendar-diagnosis.

The user's exact on-iPhone post-X failure remains unconfirmed in a native engine.
Do not describe a successful browser/persona check as proof the phone is fixed.
The next native check must tap X, verify the divider/card are actually gone, scroll
down and back up, reopen the app, and repeat with saved compact mode and reduced
motion. Record the tested version/build and result.

## Delivery

Prepared on canonical main; persona assets are refreshed without resetting saved
data. No production database/configuration change, EAS build, TestFlight upload,
submission or distribution is part of this work. Build 54 on installed iPhones is
unchanged. A native release requires a new explicit request from the owner.
