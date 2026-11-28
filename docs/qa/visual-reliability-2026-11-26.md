# Visual reliability follow-up — November 26, 2026

Completed against canonical `main` after restoring browser control. No purchase,
production deployment, EAS build, TestFlight upload, or release was performed.
Changes remain in the local working tree. Original Avery/Blake data and the
pre-existing edit to `full-action-audit-2026-11-26.md` were preserved.

## Browser access and environment

Two browser connections were both named Chrome. One was an in-app/wrapper
connection that produced activation and host-access errors. Selecting the actual
Liana Chrome profile restored control. No permissions were broadened, extension
installed, or browser security setting disabled.

Fresh disposable Visual Avery/Blake accounts used real local Supabase Auth,
PostgREST, PostgreSQL, and Realtime. The primary Chrome tab was verified at
390 × 844 CSS pixels, with document width 390. The peer used a separate origin
and storage. A loopback-only proxy interrupted one account's REST/WebSocket
traffic and held an approval request. Google sync calls were stubbed; Calendar
and Tasks UI rows were synthetic, with no real Google account or tokens.

The first QA export reused a cached endpoint, so its purported offline check was
rejected as evidence. Exporting with `--clear`, checking the emitted endpoint,
and observing proxy request/blocked counters established the real interruption
before accepting later results. Locator actions during moving modal transitions
sometimes missed their targets; settled-state checks, keyboard activation, and
a native Chrome accessibility click distinguished these automation misses from
application defects. Full-page screenshots preserve the emulated CSS viewport.

## Additional confirmed defects and corrections

**Shopping reported success before persistence.** During a verified outage,
Create list closed the editor and announced “created” while the database had
zero matching rows. List/item creation now returns a persistence promise. The
editor retains its draft and displays an inline error on failure; retry reuses
one draft ID. Saving disables duplicate submissions and editing controls. Scope
checks prevent an old account/household response from closing a new editor.
Cancelling a failed editor removes its pending draft. Analytics runs after an
acknowledged save. Actual browser retries saved one list and one item (quantity
2), each exactly once, and peer Realtime displayed them. Cancelled drafts were
absent after recovery/reload. This is an active-session retry flow, not a promise
of durable offline delivery across process termination.

**Removed members kept a stale open household.** Removal correctly revoked
server access, but the new `removed` membership row became unreadable under the
old SELECT policy, suppressing Realtime delivery to that person. A narrow SELECT
policy permits reading only one's own membership metadata after removal/leave.
It grants no access to other members or household data. Memberships also refresh
on Realtime subscription/reconnection and app foreground; old-account callbacks
are ignored after cleanup. A new SQL assertion failed before the policy change.
Afterward, real Auth/REST/Realtime tests received `removed`, could read only the
removed user's own row, and could not access shared data. In Chrome the peer
left Shopping immediately for household onboarding. The same account rejoined
through the real invite form and recovered the saved shared list.

## Observed visual results

| Flow | Observed result |
| --- | --- |
| Chore and imported rows | Both 80 px high, 358 px wide at the verified phone width; checkbox target 44 × 44. |
| Day/Night | Synthetic 5:59 PM event appeared under Day; 6 PM appeared under Night. Running time block displayed its current timing state. |
| Completion and undo | Chores and imported events/tasks checked off. On the peer, completing the last chore showed 1/1; undo removed the caught-up state and restored 0/1. |
| Dismissed summary/calendar | X removed the Calendar heading and old card branch; one attached calendar remained below the greeting. Down-scroll moved it to translateY(-174) with pointer events disabled; up-scroll restored position and interaction. Reload preserved that household's header choice. |
| Imported details | Event opened using a real native accessibility click and closed with Done. Task details opened; 10:00–10:30 was saved and remained after reload. |
| Shopping editor | Name/quantity typing, calendar date/time picker, inline failed-save message, retry, cancel, and normal saves worked. SQL counts confirmed one row per retried draft. |
| Peer delete during outage | Peer deleted a saved list while Avery was disconnected; reconnection removed it from Avery without resurrection while preserving/retrying the new draft. |
| Offline cold start | Displayed a household-load error. After connection restoration, Try again loaded the household and saved lists. Cancelled draft remained absent. |
| Scheduled shopping | A Nov 27, 7:30 PM list appeared in the group calendar's Shopping section. |
| Chart creator/help | Help and generated-task popups opened/closed. Custom task was added. Full-screen review measured 390 × 844; Back and approval controls fit. Two-week rotation preview swapped the task between roommates and returned to the starting view. |
| Approvals and activation | Avery's approval showed the checkmark flow and returned to My Sweet. Blake saw Avery Approved / Blake Pending, approved, and saw Chore chart complete. The generated chore appeared under Upcoming with Dec 3, 12 PM EST due date. |
| Restart and in-flight vote | Restart showed both Pending and incomplete status. Held Avery's approval, restarted again from Blake, then released it: no success animation; error required reviewing the latest chart, with 0/2 approvals. |
| Borrowing | Self-owner/borrower saved and closed successfully. Other owner required a name; named Other record saved successfully. |
| Household setup/switch | Created a second home using Other, selected dishwasher, renamed a suggested chore, changed its frequency through the popup, and skipped chart setup. New home showed its Google connection link, with no old imported items or shopping lists. Returning restored the original home's data. |
| Settings/profile | Household status shortcuts/dropdown worked. Explicit Save Changes persisted the profile name across reload. Closing settings without Save Changes correctly discarded that profile draft. |
| Random tasks | Added Up for grabs; peer saw and claimed it. It immediately left the top section and appeared under the claimant's Upcoming with a due time 24 hours later. Completing it kept it absent from the top. |
| Member lifecycle | Removal confirmation worked; after the correction the removed peer immediately exited the household. Rejoin retained the account and restored saved shared records. |

## Validation and evidence

- Workspace typecheck passed; **97/97 mobile test programs passed**. These include
  actual callback/hook/component execution with controlled dependencies; they
  are not 97 native E2E tests.
- All **10/10 PostgreSQL rollback suites passed**, including own membership
  visibility after leave and continued denial of peer/household access.
- Independent database-session concurrency/lifecycle suite and actual local
  Auth/PostgREST/Realtime suite passed again, including real revocation delivery.
- Calendar screen regression passed in America/New_York and UTC. Its fixture
  previously mixed a UTC scheduled day with the device day after UTC midnight;
  the fixture now consistently uses the device zone. No production calendar
  algorithm was changed for that test correction.
- Local Expo web and iOS/Hermes exports passed; `git diff --check` passed.
- Added `shoppingDraftSave.test.ts` and `membershipRecovery.test.ts`. Existing
  analytics fixtures now await acknowledged shopping saves and assert no item
  name is sent for a failed save.

![Attached calendar after summary dismissal](visual-reliability-2026-11-26/calendar-final.jpg)

![Failed Shopping save retains the draft](visual-reliability-2026-11-26/shopping-save-error-final.jpg)

![Full-screen chore review](visual-reliability-2026-11-26/chart-preview-final.jpg)

![Removed member exits the household](visual-reliability-2026-11-26/removed-member.jpg)

Raw logs and reproduction helpers remain in `/tmp/sweetmate-visual-reliability`
(outside Git). Screenshot evidence above contains only dummy test records. The
fresh visual accounts/households and private fixture credentials were removed;
the fault proxy and disposable preview servers were stopped. The standard
Avery/Blake launcher was restored, its viewport override reset, and its assets
refreshed to the normal local backend (54321, not the stopped proxy).

## Limits and rollout

This completes the targeted browser follow-up to the six-area reliability audit;
it does not establish that every possible button, state, race, or device is bug
free. Desktop Chrome at phone dimensions is not a physical iPhone. Native
haptics/jiggle feel, iOS keyboard/safe areas, VoiceOver, Reduce Motion settings,
Safari/WebKit and gesture animation must still be checked on-device. A local
Hermes export compiles JavaScript; it does not create/install an iOS binary.

Google OAuth, real calendar refresh/revocation, push delivery, vendor erasure,
media permissions/uploads, and live payment-related external screens were not
exercised in this follow-up. Expense retry/concurrency and account deletion were
tested through the local technical suites, not a fresh full visual traversal of
every expense/account screen. OS termination during an unacknowledged write and
a durable offline outbox remain outside this pass.

Three new migrations (202611260004–202611260006) are prepared and registered only
in local QA. Production must receive them with the later authorized rollout.
None of these local fixes changes the installed TestFlight build 54. No production
schema/data, Google configuration, billing, or store settings were modified.
