# SweetMate interaction audit — November 26, 2026

## Scope and method

Audited the canonical `Homie2-main` checkout on `main`. Preserved existing uncommitted work. Used the local Supabase QA backend and a separate **Interaction Audit Home**, with two disposable accounts (Audit Avery and Audit Blake). Existing Avery/Blake households and production records were not reset. Imported schedule checks used the separate synthetic Completion Preview fixture.

The source inventory covered **339 control locations, 26 Modal declarations and 20 popup call sites** after fixes (335 / 26 / 19 initially). These are source locations, not a claim that every dynamic instance was physically tapped. Reviewed handlers, disabled states, dismissal paths, async errors, nested sheets and permissions; combined live browser workflows with runtime regression tests. All native Modal sites have a request-close handler. The two remaining scanner flags are valid: PreferenceBar uses gestures/change/accessibility handlers, and the Upcoming divider is a noninteractive heading.

Live browser widths observed: 786 and 1710 CSS pixels. A requested viewport override did not change those existing Chrome tabs; no phone-width browser result is claimed for this audit. This does not replace physical iPhone testing.

## Defects fixed

| Area | Failure and cause | Correction and evidence |
| --- | --- | --- |
| Shared popups | Rapid taps could execute actions twice; completion/failure from an older action could close or corrupt a replacement popup. | Synchronous action lock and request identities. Runtime tests cover duplicates, chained popups, stale failures and retry. |
| Sheet dismissal | Native animation callbacks could be interrupted or missing, leaving close/handoff actions stranded. New sheets could open before the old native presentation finished. | Shared cancellable dismissal hook, once-only completion, native dismissal handoff and bounded fallback. Applied to action menus, chore/IOU editors and dragging; expense detail handoff also recovers from missing events. Runtime tests cover interruptions, absent callbacks, duplicate taps, reopen/unmount and native/web ordering. |
| Cross-sheet actions | Borrow Edit, Shopping → IOU and calendar actions could present UI while the action menu remained open. | Defer these actions until dismissal; unexpected failures appear in a recoverable popup. Browser handoffs passed; native ordering has runtime coverage. |
| Manual chore edit | Edit/reassign accepted changes but AppContext restored the old assignee and date. | Explicit manual edits now retain the requested assignee and household date. Completed history and unrelated occurrences remain protected. Reproduced before; verified the chore moves from Avery to Blake afterward. |
| Shopping/borrowing rows | Rows advertised a button but only handled long presses. | Normal taps now open their actions. Shopping check/delete controls stop propagation. Verified row actions and independent checklist taps. |
| Web reorder | Shopping drag handles received a literal no-op callback. | Real HTML drag/drop plus accessible Move up/down and Done controls. Verified live order changes; runtime tests cover immutable moves, cancellation and native delegation. |
| Borrow dates | UTC formatting shifted local date inputs by a day; relative labels rounded partial days. | Local calendar-date formatting and calendar-day comparisons. Live edit kept December 3 unchanged; timezone/DST/leap-day tests pass. |
| Borrow cancellation | Backdrop close retained the edit ID and form fields, so Add could reopen old editing state. | One close/reset path for backdrop, system close and a visible labeled X. Verified Edit → Close → Add is blank. |
| Shared Add button | A throwing consumer could leave the duplicate-tap lock permanently engaged. | Schedule unlocking before invoking consumer code. Runtime fault-injection test verifies retry. |
| Chore creator | Permanent preference changes left duplicate popup layers and could trap the screen. Two sibling sheets had identical React keys. | Distinct household-scoped keys. Reproduced before; afterward Always me/Never me retained one responsive dialog. Added a repository JSX sibling-key check. |
| Chore due labels | Group could call a chore due today “Tomorrow” by rounding remaining hours. | Shared calendar-day label helper across My Sweet and Group. Live date agrees; tests cover times, timezones and DST. |
| Applied chart recovery | Another member could see chart complete without receiving chores after missed realtime events; applied charts returned early without reading rows. | Hydrate an already-applied chart, recover on reconnect/web focus and merge pending local edits/deletions. After two-person reapproval, both members immediately show their upcoming chores with actual due dates. Merge regression tests cover new/retired rows and local edits/deletions. |
| Setup return navigation | Canceling setup replaced its route with a second Settings page. Close appeared dead because it revealed the original Settings. | Dismiss to existing Settings/tabs. Live Cancel → Settings → Close reaches My Sweet in one close; route tests cover cancel, additional join, skip and completion. |
| Imported Google task editing | Selecting Day/Night silently cleared an entered time block. | Preserve times; timed tasks derive Day/Night from Start. Untimed tasks retain manual selection. Explain the disabled period controls while times exist. Live invalid-time validation and 6:15–6:45 PM save passed; runtime test verifies times survive period actions. |

## Live coverage

| Area | Workflows exercised |
| --- | --- |
| Navigation / My Sweet | All five tabs, section expansion, Today/Completed, chore completion/undo, summary dismissal, calendar date selection, settings/alerts entry and return. |
| Chores | Empty/invalid form validation, assignment mode, recurrence, category/notes, create, edit and two-member reassignment, completed filtering/undo and action menus. |
| Group | Member panels, weekly/calendar views, date selection, planned Shopping entry on group calendar, up-for-grabs creation, other-member claim, completion and removal from the top Random Task board. |
| Shopping | List naming and create, planned calendar date/time picker, add item/quantity, row menu, check/undo, two-step undo menu, list assignment, reorder controls and shopping-to-IOU handoff. |
| Borrow | Private/public records, privacy separation between members, normal-tap menu, edit/date round trip, close/reset, owner/borrower selection, return request, owner return and history entry point. |
| Expenses | Shopping-linked IOU create, equal/custom split validation, details → edit/save, invalid repayment amount, partial repayment, reversal, settle/reopen, void/restore and confirmation/cancel paths. These were local bookkeeping records; no money moved. |
| Settings / setup | Profile rename/save, appearance radio and activity switch, planning/household/account/privacy accordions, invite-code copy, household manager, invalid join code/cancel, member setup edit through Home/Items/Review, frequency/custom frequency popup, difficulty edit/reset-cancel, feedback validation/cancel and Quick Guide close. No feedback message was sent. |
| Planner / approvals | How does this work, generated task edit/difficulty/frequency save, custom task add, slider keyboard adjustment, Always me/Never me, revised preview, next-week preview, send-for-approval, pending member list, both member approvals/checkmark return, applied chores, restart/reset and reapproval. |
| Essentials | Section expansion, owned checkbox, shortlist recommendations, save shortlist, add selected items to Shopping and navigation to resulting lists. |
| Alerts / auth | Restart alert notification and destination, read-all state, sign out, sign-in/sign-up mode controls and optional signup consent toggle. Restored the disposable test account afterward. |
| Imported schedule | Synthetic event/task detail popups, event completion inside details, task check/undo, time validation, period controls and saved timed task. Synthetic Google data did not require third-party access. |

## Subsequent coverage gap

Build 54's permanent shopping-list deletion was subsequently reported as failing.
The original live Shopping coverage did not establish deletion surviving two-member
sync and reopening. See [the follow-up reproduction, correction and regression
coverage](shopping-list-deletion-2026-11-26.md). Source inventory and passing tests
are not evidence that every dynamic control and persistence lifecycle was tested.

## Verification

- `pnpm run typecheck` — passed across workspace projects.
- `pnpm --filter @workspace/mobile run test` — all **77 test programs** passed.
- Local Expo export for **web and iOS/Hermes** — passed. This is a local export, not an EAS/native release build.
- `git diff --check` — passed.
- Runtime suites added: popup interactions, modal dismissal, manual chore edits, web reorder, borrow dates, chore labels, shared interaction contracts and setup navigation. Extended schedule and chore sync regression tests.
- Evidence/logs: `/tmp/sweetmate-interaction-audit/`; screenshots `verified-my-sweet.jpg` and `verified-chart-approval.jpg`.
- Updated the running canonical Avery/Blake browser preview's static assets after verifying its process cwd. Saved household records and credentials files were preserved.

## Remaining device / external checks

A physical iPhone or native simulator was not available. Real iOS animation presentation, haptics, swipe/drag gestures, Apple/Google OAuth return, OS calendar/reminder/photo/notification permissions, native share/copy, background/foreground transitions and device network interruption still need a native smoke pass. Browser and fault-injection tests do not certify those native integrations. Existing auth/Google connection and permission logic remains covered by the automated suites.

Permanent account/household deletion and actual third-party consent/message transmission were not executed. Destructive confirmations/cancel and data/permission logic were reviewed/tested without deleting real records. No production data changes, Git commit/push, EAS build, TestFlight submission or distribution were performed for this audit. The installed TestFlight build 52 is unchanged until a separately authorized release.
