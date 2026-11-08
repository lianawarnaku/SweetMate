# Expense repair and staged database rollout

Status: implemented and tested locally on November 8, 2026. **The database migration has not been applied to production. No TestFlight build or release is part of this change.** Deployed expense policies, constraints and Realtime configuration have not been independently queried: no authenticated database/management connection was available. Repository migrations establish the intended configuration only.

The original approved findings are preserved in [the November 8 audit](expenses-audit-2026-11-08.md).

## Architecture

The updated client uses explicit expense operations instead of interpreting a complete local array as the desired server table. A durable per-account/household outbox retains operation IDs through retries and uncertain network responses. Initial loading and reconciliation preserve pending operations; absence from a cached array never issues a deletion. Server success is awaited before completed-action feedback. Failed writes remain visible and retryable instead of silently succeeding locally.

`202611080002_expense_mutations.sql` adds the atomic `mutate_expense` RPC, a positive optimistic `version`, durable operation receipts, deletion tombstones, immutable Shopping source claims and legacy correction barriers. The expense table uses `REPLICA IDENTITY FULL`. Receipts, claims, barriers and cutover metadata are not directly writable or readable by authenticated clients; household members can read tombstones. Authorized household deletion retains its FK cascade, including expenses and private receipts/claims/barriers; direct unversioned expense deletion remains blocked. All RPCs verify active membership and lock existing expense rows before the household row, matching the lock order of old-client UPDATEs. The transaction also owns source claims and operation receipts, so errors roll back the entire operation.

The client UI renders confirmation inline within Details and closes Details before handing off to Edit, uses a shared action policy, removes the stale long-press suppression flag, and exposes saving/error states. Expense dates remain local `YYYY-MM-DD` values. Recurring expense controls and legacy recurring badges are hidden until real independently repayable occurrences exist; Calendar shows actual saved expense records rather than inventing future unpaid IOUs. Existing recurrence metadata is retained when editing old records.

## RPC contract

```sql
public.mutate_expense(
  p_household_id uuid,
  p_operation_id uuid,
  p_action text,
  p_expense_id text,
  p_payload jsonb default '{}',
  p_expected_version bigint default null
) returns jsonb
```

The optional transport-only payload field `_expectedActorId` must equal `auth.uid()` when supplied; it is stripped before validation, receipt comparison and storage. This prevents a queued/in-flight operation from being submitted under a newly switched account's JWT.

A successful response is `{ "expense": <normalized public.expenses row>, "deleted": false, "id": "..." }`. Deletion or replay of an operation whose expense was subsequently deleted returns `{ "expense": null, "deleted": true, "id": "..." }`. The normalized row contains `version`; `entry.manuallySettled` distinguishes whole-expense settlement from settlement derived from repayments. A receipt replay returns the current row, never a historical row that would reintroduce a deleted expense or undo a peer update.

- `create`: payload is an Expense entry. The server supplies creator, identity, timestamps and initial payment state. Use a new stable expense ID and operation UUID. An existing or tombstoned expense ID cannot be reused.
- `update`: payload is an entry patch. Creator-only, with payer fallback for records predating creator metadata. Supply the last observed `p_expected_version`.
- `settle`, `reopen`, `delete`: payer, creator or active household host; supply `p_expected_version`.
- `repay`, `undo_repay`: operate only on the authenticated actor's positive non-payer share. No expected version is required; unrelated payment facts are merged atomically under the row lock. A payload cannot target another person.
- `reopen` removes the manual settlement flag and preserves actual repayments. If all positive shares are repaid, it remains automatically settled. A participant can subsequently undo their own acknowledgement. `undo_repay` is rejected while manually settled; reopen first. Recording an actual own repayment remains possible while manually settled.
- The same operation UUID may be retried only by the same actor with exactly the same household, expense, action, payload and expected version. Reusing it for another request is rejected. Unknown-commit timeouts retain that UUID on retry.

Cents are canonical, positive and within JavaScript's safe integer range. Each unique participant has one nonnegative integer allocation; allocations must sum exactly to the total. Create and financial edits require active participants/payer. Display `amount` and dollar `splits` are derived from cents, so inconsistent caller aliases cannot inflate debt. Date is strictly `YYYY-MM-DD`. Zero debtor shares do not require repayment or block settlement. A payer-only expense has no outstanding debt.

Household, creator and Shopping source identity are immutable. After any repayment or settlement, amount, payer, participants, allocations, date and split mode are locked; safe descriptive changes remain creator-only. A Shopping conversion's total cents are always immutable; payer/splits/date may be changed before a payment or settlement. Existing settled rows receive only an inferred `manuallySettled` metadata field during migration; money and repayment flags are preserved.

Version conflicts use SQLSTATE `40001` and require refresh/review before a new edit/delete/settle/reopen operation. They are not a transient network retry of the stale intent. Authorization uses `42501`; deleted/missing and duplicate/source errors are surfaced explicitly. A failed transaction leaves no success receipt or partial source claim.

## Shopping conversion contract

`shoppingSource.type` is `shopping-item` or `shopping-list`; `shoppingListId` must reference an authoritative list in the household. An item source has exactly one `shoppingItemIds` element belonging to that list and household. If the item's server price is present, the expense must equal that price in cents. An unpriced item may use the manually entered positive total.

A list source has one lifetime purchase cycle. The server derives its item IDs and name, checks `listTotalCents` against the floor of known authoritative item prices, subtracts the **durable** individual item claim total, and requires the expense amount to equal the remainder. Unpriced items are supported by entering a list total at least as large as the known-price floor; the server does not claim to verify an external receipt. Create a new list for another shopping trip.

An individual conversion also writes the item's `entry.convertedExpenseId` in the same transaction as the claim and expense, without changing its completed state. This link survives an outbox acknowledgement after app restart; claims remain the authoritative duplicate protection if a legacy Shopping snapshot subsequently drops its link. A completed list conversion prevents later item conversions on the same list. Deleting an expense or Shopping row never releases its claim. Historical sources already recorded in `entry.shoppingSource` are backfilled; duplicate historical item sources reserve their combined amount without silently deleting or refunding existing IOUs. Historical conversions that never recorded any source identity cannot be reconstructed automatically and need separate review if suspected.

## Build 42 compatibility and rollout

Build 42 submits whole expense rows and unversioned DELETEs. Its snapshot contains no trustworthy original server version, so a timestamp cannot prove that an edit is current. The compatibility trigger therefore:

- allows fresh, authorized legacy creates, but rejects pre-cutover historical-cache bootstrap;
- allows only the authenticated participant's additional positive repayment facts and authorized whole-expense settlement;
- merges true payment facts and preserves settlement instead of replacing them from stale snapshots;
- skips UPDATE entirely when a snapshot adds no new fact, avoiding Realtime echo/version churn;
- rejects direct financial/descriptive edits and every direct DELETE, requiring the updated client;
- blocks a legacy repayment flag after that actor explicitly used `undo_repay`, and blocks legacy manual settlement after `reopen`. These durable barriers are independent of client clocks. Explicit updated-client operations remain available.

These restrictions intentionally mean **old-client Edit/Delete require an update**, and corrected repayment/settlement facts must subsequently use the updated app. Existing data is preserved. The migration is staged rather than silently deployed: review its policies and schema against the actual database, have the compatible client and recovery/support plan ready, and coordinate the short server-first compatibility window or require upgrade before cutover. The updated client requires the RPC; do not ship it against a database missing this migration. No production schema or permissions were changed during local implementation.

## Verification

Run the meaningful database tests with disposable dependencies outside the repository:

```sh
npm install --prefix /tmp/sweetmate-db-tests @electric-sql/pglite@0.5.15 embedded-postgres@18.6.0-beta.19 pg@8.23.1
node scripts/expenses/test-database.mjs /tmp/sweetmate-db-tests/node_modules/@electric-sql/pglite/dist/index.js
node scripts/expenses/test-concurrency.mjs /tmp/sweetmate-db-tests/node_modules
```

Local run used the already-present `/private/tmp/sweetmate-chore-db-tests/node_modules` dependency directory. Both suites passed. The native suite initializes disposable PostgreSQL bound to `127.0.0.1:55482`, uses synthetic users/records and removes its temporary database. It never loads Supabase credentials. A sandbox that forbids PostgreSQL shared memory or localhost binding needs approval for this local test command, not production access.

Validated using real migrations: active/former/outsider role matrix; legacy null-creator authorization; canonical money/date/type validation; immutable identities; optimistic versions; own positive repayments/undo; payer/host settlement; reopen preserving payments; zero shares; source ownership/price/remainder/uniqueness; historical source and manual-state backfill; persistent tombstones; receipt replay after update/delete; private-table/helper permissions; expected-actor protection; actual owner-only household RPC cleanup across expenses/private tables; safe legacy creates; rejected edits/deletes; no-op snapshot suppression; correction barriers despite future client timestamps. Native multi-session tests additionally hold transactions open to verify independent repayments, duplicate create retries, competing source conversions, mixed old/new UPDATE and ON CONFLICT contention, stale-version settlement, and stale legacy repayment/settlement arriving during undo/reopen.

Final frontend validation passed: repository `pnpm run typecheck`, the complete `@workspace/mobile` test suite (including the expense command and actual screen-callback regressions), and Expo web export. Commands used `--config.verify-deps-before-run=false` for the local pnpm installation. Frontend tests cover operation/outbox/hydration/recovery and UI regressions separately; the UI callback tests establish state and wiring, not physical iPhone presentation.

## Remaining verification and follow-up

Before rollout, confirm deployed policies/constraints/function grants and Realtime behavior with an authenticated management connection. Test two actual accounts/devices through online/offline/reconnect, lost-response retry, app restart, household switching, deletion and simultaneous repayments. Verify native iOS Details → confirmation/edit dismissal, large text/long participants, saving/errors and touch targets on device; local SQL and UI source checks do not establish native presentation behavior.

`expenses.paid_by` still has the existing `auth.users ON DELETE RESTRICT` foreign key. Account deletion therefore needs a separate deliberate policy for retained shared financial history/anonymization and a transaction-level integration test. This repair does not drop that protection or silently remove other household members' expense history.
