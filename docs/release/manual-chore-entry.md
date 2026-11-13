# Manual chore entry and Calendar date repair

November 12, 2026. Applies to My Sweet and group tabs, which share ManualChoreForm.

## Behavior

New chores start with a title field and Add Chore. Assignment, schedule, category, points and notes remain behind one optional details control. Editing opens existing details. Removed the shared-definition picker, its explanation and existing-chore chips. A typed chore creates its own definition; entering an existing title does not link or reuse that chore. Default is a one-time chore due today in the household timezone, assigned to the current user or the roommate selected from the group tab.

Both screens reveal successful additions: the home screen expands My Chores and selects Today or the chosen future date; the group screen returns to active chores and expands the assignee, or opens the future calendar date. Future-day filtering includes scheduled chores instead of discarding them before the day filter can run.

Manual due dates are created at 23:59 in the household timezone, and the explicit scheduled date is retained. Previously phone-local end-of-day dates could become the next day in the household timezone and disappear from active lists.

Google Calendar connection was reported working by the owner. OAuth scopes, provider setup and sign-in were left unchanged. Both export actions now pass the household scheduled date, avoiding the next-day UTC date of an evening chore. The server already uses start.date/end.date rather than dateTime, which creates an all-day event. Creation does not automatically export: choose Add to Google Calendar on the saved chore. Exported copies are not automatically synchronized, and duplicate export returns alreadyAdded; correct an already-exported event directly in Google Calendar.

## Validation

- Workspace typecheck.
- Full mobile test suite, including actual shared-form submission with local React Native/vendor stubs, independent identity, duplicate-submit guard, household dates and active-list visibility.
- Date regressions under America/New_York and Pacific/Auckland device timezones, including daylight-saving dates.
- Calendar client export regression: Nov 12 New York end-of-day instant is sent as Nov 12, rather than its Nov 13 UTC date.
- Integration runtime checks: all-day start/end date fields, exclusive end date, stable event ID, duplicate response, linked Google identity, scope validation and token expiry.
- git diff --check.

No physical iPhone, authenticated Google export or delivered app update has been verified in this session. These changes are not yet in build 47. On a test device: add a title-only chore in each tab; confirm immediate visibility in the appropriate personal/group list; export once, verify the primary Google calendar's all-day row and household date, then repeat to confirm no duplicate. Test future date and selected-roommate entry, and editing an existing recurring chore.
