# SweetMate chore-system audit

Audited against `main` after commit `45a303b` on July 27, 2026.

## Chore action permission matrix (updated August 2, 2026)

The authenticated user ID and active `household_members` roster are
authoritative. `owner` is the only elevated household role in the live schema;
the UI's “host” flag maps to that role.

| Action | Membership/relationship rule | Owner override |
| --- | --- | --- |
| View/details | Any active household member | Yes |
| Complete open occurrence/pick up | Any active household member | Yes |
| Reverse completion | Assignee | Yes |
| Add to own calendar | Any active household member | Yes |
| Nudge | Active member; another member's open chore | Yes |
| Edit/reassign | Assignee or creator | Yes |
| Delete occurrence/series | Creator | Yes |

`resolveChorePermissions` is the shared client matrix. Supabase RLS separately
requires active membership for the canonical `household_states` row and rejects
former members and cross-household users. Every active member can open the one
shared action menu; its tiles are filtered by the matrix instead of by a
host-only gate.

The authenticated Supabase session is also the sole current-user authority.
Legacy cached `currentUserId` values and the asynchronously hydrated roommate
snapshot must not authorize actions. This matters for regular members because
their role value does not change during initial membership hydration; the
context dependency list explicitly includes the canonical completion callback
so consumers cannot retain its pre-membership closure.

## 1. Chore-system overview

Status labels in this report:

- **Tested**: confirmed by an automated test added or already present.
- **Inspected**: confirmed directly from current source.
- **Inferred**: follows from control flow but was not run against a signed-in Supabase household.
- **Unverified**: requires a device, multiple authenticated accounts, or a live database.

SweetMate has three related but distinct systems:

1. `PlanningScreen` generates `GeneratedTask` objects from the household profile and custom tasks, balances them with `buildBalancedChart`, and converts them into `Chore` records.
2. `ManualChoreForm` creates or edits an individual `Chore`, including a fixed assignee or round-robin assignment and one of four recurrence intervals.
3. `AppContext` is the authoritative runtime store. It validates mutations, reconciles independently dated recurring occurrences through the current local day, awards points, and persists the entire household state as one JSON document.

There is also a proposal/approval subsystem (`proposed_charts`, approvals, alerts, and RPCs). It is not the persistence model for actual chores. `alerts.tsx` can propose a balanced chart, but the current planner directly calls `addChores`; approved proposals do not themselves create dated chores.

## 2. Architecture and dependency map

```text
Household profile + feature registry + custom tasks
  -> taskGenerator.generateHouseholdTasks
  -> choreEngine.buildBalancedChart
  -> PlanningScreen maps tasks to Chore drafts
  -> AppContext.addChores

ManualChoreForm
  -> AppContext.addChore / updateChore
  -> optional iOS Reminder update/removal

AppContext.chores (authoritative in-memory array)
  -> My Home list and calendar (index.tsx)
  -> Group activity list (group.tsx)
  -> Leaderboard
  -> overdue alerts
  -> external Reminder/Google Calendar export

AppContext sharedState
  -> AsyncStorage per-user/per-household cache
  -> Supabase household_states.state JSON snapshot
  <-> Supabase Realtime whole-snapshot replacement

AppContext.completeChore
  -> completion fields + points
  -> if recurring: append next dated Chore record

Supabase proposed_charts + proposed_chart_approvals
  -> alert review/approval workflow
  -> liveChart metadata
  (no direct dated-Chore foreign key)
```

There is no React Query, query-key registry, server action, chore API endpoint, dedicated `chores` table migration, background scheduled job, or database recurrence trigger in this repository. Chore refresh is whole-snapshot Supabase Realtime replacement.

## 3. Data-model explanation

### `Chore` (`context/AppContext.tsx`)

| Field | Meaning |
| --- | --- |
| `id` | Client-generated UUID/fallback string; primary identity inside the JSON array |
| `householdId?` | Household isolation key; normally injected by `addChore` |
| `title`, `description?` | User-visible name and notes |
| `creatorId?` | Auth/current member that created the chore; controls editing/deletion with host privilege |
| `assignedTo` | Active household member ID; may become `""` with `assignmentMode: "unassigned"` after member removal |
| `assignmentMode?` | `specific-person`, `round-robin`, or `unassigned` |
| round-robin fields | Participant IDs, all-members flag, cursor, and excluded IDs |
| `dueDate` | ISO timestamp; manual chores use local 23:59 converted to UTC |
| `initialDueDate?`, `nextDueDate?` | Series anchor/current next value; names are not enforced invariants |
| `completed`, `completedAt?` | Per-record completion state and UTC completion timestamp |
| `points` | Numeric reward; manual UI offers 5–30 but model does not constrain it |
| `category` | cleaning, kitchen, bathroom, laundry, outdoor, or other |
| `recurring?` | daily, weekly, biweekly, or monthly |
| `recurrenceSeriesId?` | Series identity; initialized to the first record ID |
| `occurrenceIndex?` | Integer schedule index inside a recurring series |
| `nextOccurrenceId?` | Link from a completed occurrence to its generated successor |
| `sourceKey?` | Deduplication identity for generated/template chores |
| `createdAt?`, `updatedAt?` | Client UTC timestamps |

There are no explicit scheduled-date versus due-date fields, recurrence weekdays, recurrence end dates, timezone, archive flag, soft deletion, template foreign key, parent ID, or persisted completion-owner field.

### Actual recurrence model

The app uses a combination:

- **Persisted instances:** current/past scheduled dates are reconciled into independently dated records; completion also ensures a future successor exists.
- **Dynamic projection:** `deriveCalendarItems` projects dates from `initialDueDate` even when no persisted instance exists.
- **No independent template:** every generated instance retains the recurrence rule and most series data.

Therefore it is not a clean template/instance model. Historical completion is preserved only because completed records remain in the shared array.

### Storage and database records

- `household_states.state`: the actual chores array lives inside this JSON snapshot. The entire shared state is upserted after a 220 ms debounce.
- AsyncStorage: `sweetmate:user:<user>:sweet:<household>:state` caches the same household state.
- `proposed_charts`: UUID, household, creator, status, JSON payload, created timestamp.
- `proposed_chart_approvals`: one approval per member/proposal.
- `item_difficulty`: household/category/item difficulty with a unique constraint.
- `member_task_preferences`: household/member/key/value with a unique constraint.
- `nudges`: separate rows reference chore IDs as text, but there is no chore foreign key.

There is no database uniqueness constraint for chore IDs, occurrence `(series, index/date)`, or generated `sourceKey`.

Both `addChore` and `addChores` enrich records with household, creator, series, index, and timestamps. Legacy linked recurring records without a series ID are normalized during occurrence reconciliation.

## 4. One-off chore lifecycle

1. **Inspected:** The user opens the plus sheet from My Home or the per-member sheet in Group.
2. `ManualChoreForm` defaults to specific-person, current/target member, one-time, tomorrow, cleaning, 20 points.
3. The form trims title/notes, parses `YYYY-MM-DD` as local 23:59, and prevents duplicate synchronous submission with a ref.
4. `addChore` rejects blank titles, invalid dates, inactive assignees, wrong households, invalid rotation membership, and duplicate generated `sourceKey`.
5. The new record enters `AppContext.chores`; shared-state persistence and Realtime sync follow.
6. My Home shows all personal chores by default. “Today” uses an exact local calendar-day comparison. Group shows every household chore, sorted with completed last.
7. Completion toggles the record, sets `completedAt`, and adjusts assignee points.
8. On later days it remains visible under “All” and in Group; it becomes overdue if incomplete. It is not copied or carried to a new date.
9. Creator/host can edit only while incomplete. Deletion is hard deletion from the JSON array.

Calendar retention of a completed one-off and household isolation are **Tested**.

## 5. Recurring chore lifecycle

1. Manual recurrence supports daily, weekly, biweekly, and monthly only. There is no weekday multi-selector, start/end range, skip action, or “edit occurrence vs series” choice.
2. Calendar projection calculates future occurrences from `initialDueDate`; an idempotent reconciliation pass materializes every scheduled occurrence through the current local day.
3. Incomplete persisted occurrences remain active on later selected days without changing their original `dueDate`.
4. Completing one record marks only that occurrence complete and ensures one future successor exists, reusing a matching series/date occurrence when present.
5. Reconciled occurrences begin unchecked. Round-robin occurrence assignment advances by occurrence index.
6. Uncompleting the preceding record deletes its generated successor only when the successor is still incomplete. If the successor is complete, history remains linked.
7. Editing changes only the selected incomplete persisted record, although the form labels it generically as “Save Changes.” It can retain the old `initialDueDate`, so changing the due date may not change dynamic calendar projection as expected.
8. Delete scopes:
   - occurrence: removes the selected record only;
   - future: removes the selected and same-series records at or after its occurrence index;
   - series: removes every same-series record, including completed history.

**Tested:** weekly projected dates, stored completion versus unchecked future projection, monthly clamping, leap year, month transition, weekday preservation.

**Risk:** calendar projection and persisted generation can describe the same date from different source records. The map deduplicates by series/date, with later records overwriting earlier ones, but this is not protected in storage.

## 6. Assignment lifecycle

- Specific-person assignment must reference an active `roommates` member on create/update.
- Editing before completion can reassign the selected record.
- Completed records cannot be edited, preserving their stored assignee for leaderboard attribution.
- Round robin stores ordered participant IDs. Inactive/excluded members are removed; all-members rotation appends newly active member IDs sorted by ID.
- Member removal rewrites open chores: rotations choose a remaining participant, while specific-person chores become unassigned. It clears proposal state.
- The creator/host can edit a materialized current or overdue occurrence independently; future projected dates are not editable until materialized.
- Household switching clears chore state before loading the selected household cache/snapshot.

Participant filtering and household calendar isolation are **Tested**. Multi-account reassignment and removal sync are **Unverified**.

## 7. Completion lifecycle

- `completeChore` is a synchronous client mutation with no per-chore lock.
- A rapid second tap can immediately uncomplete the just-completed record.
- Completion credits the assigned member. `pickUpChore` calls `completeChore`, then compensates points and awards a 25-point bonus; there is no persisted `completedBy`.
- Leaderboard counts `completed` records by `assignedTo`; it checks an undeclared legacy `completedByExtra` field, but pickup does not store it.
- Realtime persistence is optimistic. Supabase upsert failures are logged but do not roll back local completion or points.
- Whole-snapshot last-writer behavior means concurrent users can overwrite unrelated or newer chore mutations.

No completion operation is backed by a database transaction, revision, compare-and-swap, or idempotency key.

## 8. Date and timezone behavior

- Manual dates are local date input converted to an ISO UTC timestamp at local 23:59.
- Completion timestamps and database timestamps are UTC ISO/timestamptz.
- “Today,” overdue labels, recurrence advancement, and day boundaries use device local time.
- There is no household timezone. Two household members in different timezones can see different date labels and overdue states.
- There is no midnight timer/refresh. A rerender, navigation, state update, or app resume is needed for labels/filters to recalculate.
- Recurrence advancement uses `Date.setDate`/`setMonth`, which follows the device timezone and preserves local wall-clock time through DST.
- Planner/setup generation also uses `Date.now() + 86_400_000 * days` in places, which is elapsed-time arithmetic and can shift local wall time across DST.
- The edit form initializes with `toISOString().slice(0, 10)`, which reads the UTC date and can show an adjacent date in extreme positive-offset timezones.
- Calendar utilities normalize dates to local noon for display, reducing UTC day-shift risk.
- Week UI is inconsistent: My Home starts weeks on Sunday; Group chart helpers label Monday through Sunday and chart weeks begin Monday.

Automated tests pass in both `America/New_York` and `UTC`, covering year/month/leap boundaries and recurrence projection. Actual 11:59-to-midnight rerender and device DST UI behavior remain **Unverified**.

## 9. Builder component inventory

### Manual builder (`ManualChoreForm`)

| Control | State/default | Validation/persistence | Accessibility/edge notes |
| --- | --- | --- | --- |
| Title input | existing title or empty | trim; nonblank only; no max length | no explicit label prop/max length |
| Assignment chips | specific-person default | active members validated in context | chips lack selected accessibility state |
| Assignee chips | target/current member | active member required | empty roster leaves invalid default |
| Round-robin toggle | all members true | at least one eligible participant | visible check icon; no checkbox role/state |
| Participant chips | all current members | inactive IDs filtered | order follows roommates/stored IDs |
| Recurrence chips | one-time default | four fixed intervals | no weekdays/end date |
| First due date input | tomorrow | strict date syntax/calendar validity | plain text field; past dates allowed |
| Category chips | cleaning | enum from UI/context | no selected accessibility state |
| Points chips | 20 | only shown if points enabled; numeric conversion | no model min/max; hidden points still persist 20 |
| Notes | empty | trimmed; no length bound | multiline |
| Save button | enabled styling follows title only | ref blocks duplicate sync submission; context mutation is synchronous | not actually disabled for blank/invalid input |
| Error text | null | inline validation/general save error | no live-region behavior |

Creation and editing share the component. There is no draft persistence, cancel button inside the form, date picker, weekday selector, recurrence end control, or network loading state.

### Planner (`app/planning.tsx`)

Interactive inventory includes plan-type cards, housing-type selection, amenity check rows, custom-chore text entry/removal, essentials checklist/shortlist modal, custom generated-task title/difficulty/frequency/time controls, generate/rebuild buttons, “Add Tasks” button, task previews, chart tiles, and task-difficulty navigation.

Important current behavior:

- `generateHouseholdTasks` uses the feature registry and custom task definitions.
- `buildBalancedChart` is deterministic LPT-style balancing with optional preferences/pins/exclusions, although the current planner invokes perfect-split mode with an empty preference list.
- The current `generate` path immediately calls `addChores`; it does not call `proposeChart`.
- `everyOtherDay` is persisted as `daily`, and `biweekly` generated tasks are persisted as `weekly`.
- The generated path calculates an assignment chart but does not call `setChoreChartData(chart-shaped data)`, so the chart preview/add-tasks state belongs to a separate legacy path.

### Display and lifecycle surfaces

- My Home: filters All/Today/Done, week/month calendar, completion control, manage/edit/delete sheet, external export.
- Group: per-member lists, completion/pickup/nudge, manage/edit/reassign/delete, and legacy 12-week chart calendar.
- Leaderboard: completed counts and points.
- Alerts: overdue alerts and proposed-chart review.
- iOS Reminders/Google Calendar: explicit user export; edit/delete synchronizes only an existing mapped iOS Reminder.

## 10. Existing problems and risks

Severity is an audit judgment, not a production incident claim.

### High

1. **Whole-snapshot lost updates:** chores and points have last-writer-wins JSON persistence; concurrent users can overwrite each other.
2. **No database occurrence uniqueness:** client reconciliation is idempotent by household/series/date, but concurrent whole-snapshot writers still lack a database unique constraint.
3. **Hybrid recurrence sources:** dynamic calendar projection and persisted instances can disagree about completion, assignee, or edited schedule.
4. **Series deletion contradicts history language:** “series” hard-deletes completed history.
5. **No persisted completion actor:** pickup completion ownership and leaderboard attribution are inaccurate after reload.

### Medium

1. Generated `everyOtherDay` becomes daily; generated biweekly becomes weekly.
2. Editing a recurring due date retains `initialDueDate`, potentially leaving calendar projection anchored to the old date.
3. No household timezone and inconsistent UTC/local conversions.
4. A very old high-frequency series may materialize many independently actionable overdue occurrences; the reconciliation guard caps one pass at 1,000 dates.
5. External exports represent the rule on one task but are not synchronized with generated successor IDs.
6. Planner, proposal workflow, legacy `choreChart`, and actual `Chore[]` are multiple partially connected chart concepts.
7. Optimistic sync errors have no rollback or retry queue.

### Lower-level/UI

- No title/description maximums or points bounds.
- Save looks disabled for blank title but remains pressable.
- Chips generally do not expose selected accessibility state.
- No slow-save indicator because save is local/synchronous.
- Due-date relative labels use rounded elapsed milliseconds and can be surprising near midnight/DST.
- No dedicated loading/empty/error state for manual form member loading.

No render-time state mutation was found in the audited chore paths. Persistence and Realtime effects are dependency-bounded, but their broad `sharedState` dependency intentionally schedules writes after any shared collection change.

## 11. Tests added or updated

- `choreForm.test.ts`: invalid/empty/impossible dates, trimmed leap date, year and leap-day defaults.
- `choreSchedule.test.ts`: monthly clamping, leap year, weekly month boundary, removed/excluded/new round-robin members.
- `choreEngine.test.ts`: frequency weighting, deterministic complete assignment, load spread, pins, empty-member and no-eligible-member failures.
- `calendarItems.test.ts`: completed one-off history, recurring projected occurrences, independent completion, household isolation, date-only stability.
- Existing external-store snapshot stability test was included in the mobile test command.
- Production date and rotation helpers were extracted without changing their implementations.

## 12. Test results

Commands:

```sh
pnpm --filter @workspace/mobile test
TZ=America/New_York pnpm --filter @workspace/mobile test
TZ=UTC pnpm --filter @workspace/mobile test
pnpm --filter @workspace/mobile typecheck
pnpm --filter @workspace/mobile exec expo export --platform web --output-dir <temporary-directory>
pnpm run typecheck
```

The focused tests, timezone variants, mobile typecheck, and Expo web export pass. Node prints non-failing module-type warnings because the Expo package is not globally marked ESM.

The workspace-wide typecheck reaches and passes mobile, API server, and scripts, but fails in the unrelated `artifacts/mockup-sandbox` package because two installed React type identities make refs in `calendar.tsx` and `spinner.tsx` incompatible. No lint script, component-test command, database-test command, or local Supabase test configuration exists in the current workspace.

## 13. Coverage gaps

The repository has no React Native component-test harness, Jest/Vitest configuration, Supabase local test suite, seeded multi-user fixture, or E2E device test runner. Consequently these remain unverified:

- rendered form interactions, accessibility announcements, and modal navigation;
- complete/uncomplete/pickup point mutations through mounted `AppContext`;
- Supabase failure/rollback, offline behavior, and Realtime concurrency;
- proposal RPCs/RLS against a local database;
- reminders/calendar native permissions;
- signed-in household switching and removed-member behavior;
- midnight UI refresh, physical-device DST, rapid taps, and two-client races;
- edit/delete occurrence-versus-series flows through Alert dialogs.

Recommended next tests are a mounted-context reducer test after extracting chore mutations, Supabase integration tests with two authenticated users, and Maestro/Detox flows for the manual sheet and recurrence deletion prompts.

## 2026-07-30 recurrence reliability update

Recurring chores remain snapshot-backed, but recurrence materialization now has
one lifecycle owner in `AppContext`: household hydration, local midnight, and
app foreground activation. My Home and Group only query the resulting durable
occurrences and never generate them.

Each recurring record persists a calendar-only `scheduledDate`, an
`initialScheduledDate`, and a monthly anchor day. Generated IDs are
deterministic from household ID, series ID, and scheduled date. A normalized
Supabase occurrence-key table enforces the same unique tuple under RLS, while
the snapshot merge retains deterministic local-only occurrences during
concurrent client refreshes.

Monthly schedules clamp to the last valid day of a short month and return to
the original anchor afterward (January 31 → February 28/29 → March 31).
Daily, weekly, biweekly, monthly, and one-time are the only supported schedule
types; selected-weekday, annual, pause/resume, and arbitrary interval schedules
are not currently product features.

Catch-up materializes all missed occurrences through today, preserving their
original scheduled dates and assignments. A pass adds at most 366 occurrences
per series; unusually old daily series resume on the next lifecycle pass.
Schedule traversal is capped at 10,000 dates per pass. Existing completed
occurrences count as present and are never regenerated.

For development-only clock testing, set `EXPO_PUBLIC_CHORE_NOW` to an ISO
timestamp and restart or foreground the app. Production builds ignore this
override.

## 14. Recommended implementation changes

1. Move chores to normalized database tables: recurring template, dated occurrence, completion record, and occurrence assignee. Add unique `(series_id, scheduled_local_date)` and revision constraints.
2. Define a household IANA timezone and store scheduled dates as date-only values plus optional local time.
3. Generate occurrences idempotently in one place. Do not calculate recurrence independently in lists/calendar/completion.
4. Preserve completion history on series edits/deletes; use archive/cancel-effective-date semantics.
5. Persist `completedBy` and point ledger entries transactionally.
6. Replace whole-state overwrite with row-level mutations or at minimum versioned conflict detection.
7. Consolidate planner/proposal/legacy chart concepts and make approval explicitly materialize dated chores.
8. Add explicit edit scope (“this occurrence” / “this and future” / “series”), recurrence weekdays/end date if required, and matching tests.
9. Centralize date labels and week-start rules.
10. Add a React Native component harness and local Supabase CI before changing recurrence behavior.

## 2026-08-02 non-host chore control re-audit

Follow-up to the August 2, 2026 identity fix (commit `d4ac2a1`). That commit
was correct in substance — session identity as the sole current-user
authority, active-membership gating instead of host-only gating, and an RLS
`status = 'active'` filter — but it left the same `isActiveMember` comparison
(`activeSweet?.sweetId === householdId && activeSweet.userId === currentUserId
&& activeSweet.status === "active"`) independently duplicated three times:
inline in `app/(tabs)/index.tsx`, inline in `app/(tabs)/group.tsx`, and as a
`memberships.some(...)` scan inside `AppContext`'s own `permissionsForChore`.
Three independent copies of the same identity check is exactly the shape of
bug that produced the original defect: any future edit to one copy and not
the other two reintroduces "host works, non-host silently doesn't" without a
type error or a failing existing test, because none of the three files
imported from each other.

This pass did not find that the three copies had actually diverged as of
`d4ac2a1` — re-deriving each by hand and comparing byte-for-byte showed they
agreed. So this re-audit could not reproduce a currently-broken checkbox or
three-dot menu for an active non-host member through static inspection of the
reachable code path (permission matrix → screen-local gate → `AppContext`
mutation gate → RLS). If the reported break is still observed at runtime
after pulling this commit, it is most likely one of: (a) a build/session that
predates `d4ac2a1`, or (b) a runtime-only timing issue (membership/session
hydration ordering, a stale Realtime snapshot arriving after a local
optimistic completion) that cannot be confirmed without a device — see the
development diagnostics and human verification checklist below.

Changes made:

- Extracted the identity check into one function, `isActiveSweetMember` in
  `lib/chorePermissions.ts`, and pointed all three call sites at it. The
  `activeSweet` memo inside `AppContext` was moved earlier in the provider so
  its own `permissionsForChore` could reuse it instead of re-deriving
  membership from `memberships.some(...)`.
- Added `lib/choreDiagnostics.ts`: a `__DEV__`-only `logChorePermissionCheck`
  helper. It is called from `AppContext.setChoreCompleted` (the checkbox/pick-
  up write boundary) and from both screens' `openChoreActions` /
  `handleChorePress`, logging the resolved user/household ids (presence only,
  not values), `isActiveMember`, `isOwner`, and whether the action was
  allowed. See "Reading the diagnostics" below.
- `lib/chorePermissions.test.ts` gained a fixture-based regression test (one
  household, one owner, one regular member, one assigned task, one shared
  task, one completed occurrence) exercising `isActiveSweetMember` and
  `resolveChorePermissions` together, rather than only the pure permission
  function in isolation.
- `lib/chorePermissions.test.ts` was wired into the `pnpm test` chain in
  `package.json` — it previously only ran via a separate, easy-to-forget
  `test:chore-permissions` script and was not part of the default test run.
- `lib/choreUi.test.ts` was updated to assert that My Home, Group, and
  `AppContext` all resolve membership through `isActiveSweetMember` and that
  none of the three still inlines its own `activeSweet.status === "active"`
  comparison, so a future regression of this exact kind fails the test suite.

### Reading the diagnostics

Run a development build (`pnpm --filter @workspace/mobile run dev`) signed in
as the non-host account and watch the Metro/device log for lines prefixed
`[chore-diagnostics]`. Each line reports the event (`checkbox-tap`,
`open-menu`, `complete`), whether a household/user id was present, whether
membership resolved as active, whether the account is the owner, and whether
the action was allowed. If `allowed: false` appears for a non-host tapping
their own assigned, active chore, the accompanying `isActiveMember`/
`isOwner` fields identify which side of the gate is wrong — that is the
fastest path to root-causing a runtime-only recurrence of this bug without a
debugger attached.
