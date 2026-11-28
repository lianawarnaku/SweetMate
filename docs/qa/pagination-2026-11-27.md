# Complete collection pagination — November 27, 2026

Implemented in the canonical `Homie2-main` checkout on `main`. Prior uncommitted
changes and existing real/persona records were preserved. No production data,
API setting, schema, billing, native release or TestFlight distribution changed.

## Production limit verified

Read the SweetMate **production** project `eqnogaftebuqfwwelbdx` in Supabase:
**Integrations → Data API → Settings → Max rows = 1000**. Save and Cancel were
disabled, indicating a saved value rather than an unsaved edit. This is the live
project configuration, not an inference from the repository's `max_rows = 1000`.
The verification was read-only. No production oversized fixture was inserted,
private records exported or production cap raised.

![Saved production Max rows setting](pagination-2026-11-27/production-row-limit.jpg)

## Changes

- Added `lib/pagination.ts`: fresh identically filtered requests, 250-row pages,
  ordered keyset cursors ending in unique keys, and correctly escaped composite
  cursors. Timestamp ties include the ID; Essentials uses its compound key.
- Continue until an empty page, rather than treating a short response as the end.
  This also works if the server cap is smaller than the requested page size.
- A failure, missing/repeated cursor, abort or account/household cancellation
  returns no candidate snapshot. A partial first page is never advertised as a
  complete authoritative collection. Known complete state remains available.
- Large identifier filters are split into at most 100 IDs, with complete paging
  inside each partition. The filter ID is the leading order column, preserving
  deterministic global order and avoiding an oversized household/ID query URL.
- Removed the silent 200-row expense-activity cutoff. Existing UI history controls
  can now work from the complete loaded history rather than a truncated source.
- Shopping/shared borrowing retain their existing deletion and pending-edit
  guards. Display sorting adds an ID tie-breaker for equal ranks.
- Chores subscribe before paging. Events received during hydration invalidate
  the candidate and trigger a fresh read. Reconnects reconcile full state while
  preserving edits made during loading. An empty reconnect does not bootstrap
  previously deleted chores back into the database.
- Chore writes execute once, followed by fully paged reads of the saved IDs.
  A mutating RPC is never repeated to obtain its next response page.
- Saving a Sweet Essentials shortlist re-reads the complete saved table after
  the single save RPC. Its capped `SETOF` response cannot replace the full list
  with its first 1000 rows.
- Household/member loads check scope through paging. Member-count load failures
  are surfaced instead of silently becoming zero. Approval load failures keep
  chart configuration unavailable rather than presenting partial approval data.
- Latest-chart lookup remains intentionally one row, with `created_at DESC,
  id DESC` for deterministic timestamp ties.

## Read coverage

| Collection/read | Ordering used for complete reads |
| --- | --- |
| Shopping lists/items, shared/private borrowing, expenses, item difficulty, member task preferences, former-member aliases, chart approvals, personal schedule items | Unique `id ASC`; domain display sorting remains separate. |
| Household memberships | `joined_at ASC, household_id ASC` for the fixed user. |
| Household member roster | `joined_at ASC, user_id ASC` for the fixed household. |
| Households/member counts across many households | Bounded household-ID partitions; `id ASC` / `household_id ASC, user_id ASC`. |
| Chore hydration, chart application and applied-chart repair | `created_at ASC, id ASC`. Saved-ID re-reads use `id ASC`. |
| Received nudges, including compatibility fallback | `sent_at DESC, id DESC`. Anonymous nudge column permissions are preserved. |
| Chart restart notifications and expense activity | `created_at DESC, id DESC`. |
| Sweet Essentials shortlist | `section_key ASC, item_id ASC` for the fixed household. |
| Sweet Essentials assignments | `section_key ASC, item_id ASC, user_id ASC` for the fixed household. |
| Roommate busy-status table-valued RPC | `member_id ASC`. |
| Household-completion roster check | `user_id ASC`. |

Unique configuration reads and single-row mutation representations remain
`single`/`maybeSingle`. Chart/random-task review functions already return one JSON
snapshot containing server-aggregated arrays, so the outer API row cap does not
truncate those arrays. Worker claim RPCs and the Google sync worker deliberately
process small bounded job batches; replaying a mutating claim to page its output
would be incorrect. Google provider event/task pagination was already present
and was not replaced by this PostgREST collection helper.

## Verification

- Required workspace typecheck: passed.
- Full mobile suite: **102/102 programs passed**. These are unit, hook, provider
  and source-contract programs, not 102 physical-device E2E tests.
- `pagination.test.ts`: 0, 1, 250, 1000, 1001 and 2573 records; simulated caps of
  1000, 71 and 1; failures after earlier successful pages; abort/scope changes;
  repeated-cursor rejection; deletion before the cursor; deduplicated bounded ID
  partitions; and an AST check that ordinary multi-row client SELECTs are paged.
- Actual normalized sync hook: 1207 shopping lists under a 71-row simulated cap;
  all load without phantom writes/deletions; a late-page edit saves while all
  other lists remain. Existing reconnect, peer-delete and account-switch tests
  continue to pass.
- Actual chore hydration effect: events during a held read force a new candidate;
  pending local edits/additions survive; empty reconnects clear peer-deleted
  chores without re-creating them; failed refreshes preserve complete state;
  delayed old-account reads are ignored.
- `node scripts/reliability/test-local-pagination.mjs`: real local Auth,
  PostgreSQL, PostgREST and RLS, with three disposable accounts. A normal request
  demonstrably returned **1000 of 1257** saved shopping lists. Complete reads
  returned **1257 unique rows**, identically ordered on repeated loads, for:
  shopping lists/items, chores, expenses, expense activity, shared/private
  borrowing, item difficulty, task preferences, Essentials shortlist/assignments,
  nudges and chart restart notifications. Rows were inserted in reverse order;
  timestamps were tied, and compound keys included commas, quotes, parentheses
  and a backslash.
- The same real suite loaded 1257 personal schedule items, 1258 memberships and
  households, and 1259 member-count rows. Peer private borrowing/schedule and an
  unrelated account's household reads remained denied by RLS.
- A real request for 2000 rows still loaded all 1257 through a 1000-row server
  response cap. The real shortlist save returned only 1000 rows while a single
  write plus complete read retrieved all 1258 saved items.
- All disposable test accounts and their fixture households were cleaned up.
  Existing Avery/Blake and audit records were not deleted. Initial harness-only
  setup errors (a missing household creator and selecting a protected nudge
  column) were corrected; they did not require loosening grants or RLS.
- Local Expo web, iOS/Hermes and Android/Hermes bundle exports: passed. These
  compile checks are not App Store/TestFlight or physical-device releases.
- `git diff --check`: passed.

The live suite refuses any backend other than loopback `127.0.0.1:54321` and
uses only the named `supabase_db_sweetmate-qa` database. SQL is used only to seed
its own disposable large datasets; the reads under test use real user Auth/RLS.

## Limits and delivery

- No app release was made; the installed phone build does not contain this fix.
  Local compilation does not verify on-device memory, slow-network behavior,
  native scroll responsiveness or extremely large real-user histories.
- Complete fetches retain the app's full-collection state model. Network work and
  memory grow with record count. UI virtualization/incremental history loading
  could reduce that cost later, without introducing a silent cap again.
- Multiple HTTP pages are not one database transaction snapshot. Immutable cursor
  order prevents offset skips from earlier-row deletions; existing Realtime and
  refresh guards reconcile changes. An insertion before a passed cursor with a
  lost/delayed Realtime event can require the next refresh. This is not a claim
  of transaction-wide snapshot isolation under arbitrary concurrent writes.
- The configured production cap was verified in the live dashboard. Above-cap
  runtime behavior was exercised on the isolated local backend with the same
  1000 setting, not by injecting records into production. No production role-
  specific limit overrides or performance load test were performed.
- Large data tests covered the listed collections. A 1000-member household,
  1000 approval votes, 1000 simultaneous busy roommates and physical-phone
  visual interaction were not generated/tested in this session.

Reproduce the live suite from the canonical checkout using
`node scripts/reliability/test-local-pagination.mjs`; keep the local Supabase
stack running and do not point it at production.

References: [Supabase ordered range semantics](https://supabase.com/docs/reference/javascript/range),
[querying data](https://supabase.com/docs/reference/javascript/select).
