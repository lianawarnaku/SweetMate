# Local reliability audit — November 26, 2026

The owner authorized the six proposed local reliability test areas and fixes,
with no purchase or new TestFlight build. Work is on canonical `main`, based on
`77b7e3463637cdf95ca9217984e1d9a012cc7f49`, with local working-tree changes.
The pre-existing edit to `full-action-audit-2026-11-26.md` was preserved.

## Confirmed defects and corrections

1. **Shopping reconnect recovery.** The normalized collection subscribed only
   after a successful first SELECT. An offline first load could never recover
   through Realtime. Later successful connections only retried writes, leaving
   missed peer additions/deletions absent from the local snapshot. Subscribing
   starts independently of the read; connection recovery reconciles a fresh
   server snapshot. It preserves pending additions/edits, honors peer deletions,
   rejects snapshots made obsolete by newer events, and retains drafts entered
   after a failed initial load. The same hook also serves shared borrowing.
2. **Obsolete chart approval and activation.** After a restart, approving an older
   already-approved chart returned success, although the replacement remained
   Pending. An older approved but unapplied chart could still activate during a
   new review. The database now verifies the latest current review before votes
   and overrides. An activation guard aborts and rolls back a superseded apply.
   Historical chart rows/votes remain preserved; current duplicate approvals and
   application stay idempotent.
3. **Late approval responses after switching.** The real AppContext callback
   could refresh the new household and report success for an old request. It now
   binds the operation to the original signed-in account and household, before
   sending and after asynchronous acknowledgement/refresh. A stale rejection
   refreshes the latest review only in that same account/household.
4. **Owner departure protection.** PostgreSQL interpreted the old `current_role`
   expression as its special database-role expression, rather than the intended
   household-role variable. An active owner could leave while a roommate
   remained. The renamed/qualified role lookup and household transaction lock
   enforce the existing ownership-transfer requirement. Regular and sole-member
   departures retain their previous intended behavior.

Each defect has an initial failing reproduction and passing regression retained
under `/tmp/sweetmate-reliability-audit`. Two setup errors in the new SQL harness
(parameter typing and a nonstandard invite code) were corrected. The older
account-deletion client harness also required explicit TypeScript interop settings;
that was a harness failure, not a production import defect. The Realtime service
check waits for each event before deleting its row, because authorization is
checked against the current row. Auth deletion accepts either 401 or 403 as denial.

## Six-area results

| Planned area | Execution and result |
| --- | --- |
| Connection loss and retry | Actual normalized hook with controlled failed reads/writes, manual retry, reconnect, initial-load drafts, late reads and newer events: passed. Real SQL create with a discarded acknowledgement retried the same operation exactly once. |
| Two roommates changing the same item | Actual hook with overlapping edits, a peer delete during a delayed edit, and a peer delete during an offline edit: converged without resurrection. Real Auth/PostgREST/Realtime clients observed insert/update/delete and saved peer values. |
| Household/account switch while saving | Actual hook ignores old-scope reads and stops queued old-scope work. Actual approval callback rejects late success across either a household switch or account switch within the same household. Existing borrowing and personal-completion scope tests also pass in the mobile suite. |
| Restart with old preview still open | Independent PostgreSQL sessions hold the restart lock while a stale vote/apply waits; both stale operations reject after commit. Three-member final voting serializes correctly and preserves saved chores. Same-chart replay still passes. |
| Time boundaries | 612 matrix cases across 6 household zones and 3 device zones: 17:59/18:00 cutoff, midnight/end-exclusive events, Monday week boundary, DST dates, leap day and Jan-31 monthly anchor through February: passed. |
| Disposable account/member lifecycle | Real PostgreSQL and local Auth/REST: host-only removal, immediate access denial, rejoin, owner leave prevention, actual account finalizer, ownership transfer, private/token cleanup, unchanged shared money/payment amounts, old-token denial and preserved roommate records: passed. |

## Final checks and reproduction

- Workspace `pnpm run typecheck`: passed.
- `pnpm --filter @workspace/mobile run test`: **97/97 programs passed after the visual follow-up**. These
  include controlled component/hook/provider tests; they are not 97 native E2E tests.
- Every SQL rollback suite in `supabase/tests`: **10/10 passed** on real local
  PostgreSQL, including the new stale-chart and membership-exit tests.
- New independent-session database and real local Auth/PostgREST/Realtime suites:
  passed. The suites clean up their own fresh disposable records.
- Existing account-deletion client and runtime failure suites: passed. Provider
  failures/cancellation are substituted; no real Google/Apple revocation was sent.
- Final Expo web and iOS/Hermes exports: passed. These are local compilation checks.
- `git diff --check`: passed.

Reusable commands and local-only safeguards are in `scripts/reliability/README.md`.
Raw run evidence is outside Git in `/tmp/sweetmate-reliability-audit`.

## Scope, limitations and delivery

The database operations used only `supabase_db_sweetmate-qa` at loopback ports
54321/54322. Fresh SQL/service fixtures were removed or rolled back. Existing
Avery/Blake accounts, households and saved records were preserved. Optional vendor
keys were blank for browser/native QA exports and item-name analytics stayed off.

Three new migrations are prepared in the repository and applied/registered only in
local QA: `202611260004_current_chart_review_guard.sql` and
`202611260005_leave_household_owner_guard.sql`, plus
`202611260006_own_membership_revocation.sql` from the visual follow-up. Production deployment remains
outstanding and must accompany the later rollout. No production schema/data,
Google configuration, store settings, billing, native build or TestFlight delivery
changed. These corrections are not in the installed build 54.

Browser control was subsequently restored by selecting the correct Chrome
profile connection. The targeted visual follow-up is complete, with screenshots,
coverage and limitations in [the visual audit](visual-reliability-2026-11-26.md).
It found and corrected two additional defects: false Shopping save success during
an outage, and a removed member retaining a stale open household. Local real-service
and database checks were repeated after those changes. Physical iPhone visual
results remain unverified.

This audit does not establish physical iPhone haptics, keyboard, safe areas,
VoiceOver, gesture/animation behavior, OS termination during an unacknowledged
save, durable offline recovery across process death, live provider OAuth/refresh,
production push delivery, vendor erasure or arbitrary mixed old/new client states.
An active-session retry test is not a durable offline outbox. Native/device tests
and production rollout checks still remain.
