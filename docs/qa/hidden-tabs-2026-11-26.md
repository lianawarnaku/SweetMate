# Personal tab visibility — November 26, 2026

Long-press any tab to open Hide tab / Cancel. The selected tab also supports a
stationary 600 ms hold; moving more than 8 points cancels its menu and retains
hold-and-slide navigation. Screen readers expose a Hide tab custom action.

Hidden tabs are stored in the existing user-scoped appearance preferences on
this device. They do not alter household data or another member's layout.
Restoration checkboxes appear directly beneath Show House Monitor in App
Preferences → App Appearance, only for currently hidden, available tabs. Uncheck
to restore the tab in its original order and remove that checkbox row.

At least one available tab remains visible. Hiding the active tab opens the next
visible tab, or the previous one if it was last. Routes remain registered for
internal links; a focused hidden route does not highlight an unrelated tab.
Invalid stored names and duplicates are discarded; an all-hidden stored record
restores My Sweet. No backend migration or release build is needed for these
local preferences.

## Verification

- Required workspace type check and complete mobile test suite passed.
- Web export passed; isolated QA preview used local dummy accounts/data only.
- Actual UI: long-press inactive Shopping; Cancel; reopen and hide; long-press
  the selected My Sweet overlay; hide and navigate to Group; open Settings;
  verify both checked rows beneath Show House Monitor; reload and verify saved
  rows; restore each; verify rows disappear and all five tabs return in order.
- Runtime tests: selected/inactive holds, release suppression, hold-and-slide,
  movement before drag activation, cancelled/unmounted timers, active-route
  fallback, last-tab guard, direct links, restoration, malformed storage,
  stale account callbacks, hydration guard, rapid successive hides.
- Screenshot: `/tmp/sweetmate-hidden-tabs-settings.jpg`.

Prepared locally on main. No TestFlight build or submission was performed.
