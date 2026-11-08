# Expense repair and staged database rollout

Status: **migrations `202611080002` and `202611080003` are applied and verified in production as of November 8, 2026 (America/New_York). TestFlight 1.0.0 (43) is processed and available to internal testers.** The rollout used migration source commit `65f0d38`; build 43 uses app source commit `f64808e`, whose mobile source is unchanged by the SQL-only compatibility fix.

The original approved findings are preserved in [the November 8 audit](expenses-audit-2026-11-08.md).

## Architecture

The updated client uses explicit expense operations instead of interpreting a complete local array as the desired server table. A durable per-account/household outbox retains operation IDs through retries and uncertain network responses. Initial loading and reconciliation preserve pending operations; absence from a cached array never issues a deletion. Server success is awaited before completed-action feedback. Failed writes remain visible and retryable instead of silently succeeding locally.

`202611080002_expense_mutations.sql` adds the atomic `mutate_expense` RPC, a positive optimistic `version`, durable operation receipts, historical deletion tombstones, immutable Shopping source claims and legacy correction barriers. The additive `202611080003_expense_payments_activity.sql` adds partial repayment records, household activity and recoverable void/restore. The historical 002 migration is unchanged. The expense table uses `REPLICA IDENTITY FULL`. Receipts, claims, barriers and cutover metadata are not directly writable or readable by authenticated clients; household members can read tombstones, payment records and activity under active-membership RLS. Payment amounts/actors/dates are immutable, reversals preserve original records, and activity cannot be edited or deleted. Authorized household removal retains FK cleanup of this history. Authorized household deletion retains its FK cascade, including expenses and private receipts/claims/barriers; direct unversioned expense deletion remains blocked. All RPCs verify active membership and lock existing expense rows before the household row, matching the lock order of old-client UPDATEs. The transaction also owns source claims, payment records, activity and operation receipts, so errors roll back the entire operation. Migration 003 takes an exclusive expense-table lock during transactional backfill and trigger cutover, preventing an old insert/write from escaping ledger import.

The client UI renders confirmation inline within Details and closes Details before handing off to Edit, uses a shared action policy, removes the stale long-press suppression flag, and exposes saving/error states. Expense dates remain local `YYYY-MM-DD` values. Recurring expense controls and legacy recurring badges are hidden until real independently repayable occurrences exist; Calendar shows actual saved expense records rather than inventing future unpaid IOUs. Existing recurrence metadata is retained when editing old records.

## Client improvements

Balances remain in a loading state until authoritative data arrives. Cached/offline balances show their last confirmed refresh time. Cards emphasize each person’s remaining amount, and compact All / I owe / Owed to me filters use actual outstanding cents. Recording repayment and settling an entire IOU are labeled separately; both record household accounting changes rather than moving money.

Saved requests are reviewable by expense, action, amount, time and status. An uncertain request keeps its original operation ID and can only be retried to establish its outcome. Confirmed failures remain durable drafts across restarts. Recovery refreshes permissions and current records, retains authoritative payment/identity/source facts, and restores only safe descriptions when financial terms are now locked. Discarding a failed local request does not change household data. Different intentional drafts keep separate identities even if their contents match.

A household-readable recent activity feed and the expense’s payment records show actors, amounts, dates and reversals. Voided expenses stay available under the archive icon and can be restored by an authorized manager. Existing imported repayments identify their unknown original payment date. Partial repayments leave the remaining cents outstanding, and reversing one payment keeps all other payments intact.

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

Transport-only `_receiptOnly:true` reconciles an ambiguous old queued full-payment/undo intent: an existing matching receipt returns the current row, but an absent receipt is rejected with `P0001` and “Review the repayment amount/record before trying again” before any receipt, ledger or activity write. The flag is stripped before request comparison and storage, so it can recover an actual pre-003 committed receipt. New client commands freeze the chosen cent amount/payment date or exact payment ID when enqueued, rather than reinterpreting a later remaining amount/latest record.

A successful response is `{ "expense": <normalized public.expenses row>, "deleted": false, "id": "..." }`. From migration 003 onward, `delete` means void: it returns the retained row with `entry.voidedAt`/`voidedBy` and `deleted:false`. A voided expense contributes nothing to balances, while its original settlement state and payment records remain intact. `deleted:true`/`expense:null` remains supported for historical 002 deletions; those records cannot be recovered automatically. The normalized row contains `version`; `entry.manuallySettled` distinguishes whole-expense settlement from settlement derived from repayments. A receipt replay returns the current row, never a historical row that would reintroduce a deleted expense or undo a peer update.

- `create`: payload is an Expense entry. The server supplies creator, identity, timestamps and initial payment state. Use a new stable expense ID and operation UUID. An existing or tombstoned expense ID cannot be reused.
- `update`: payload is an entry patch. Creator-only, with payer fallback for records predating creator metadata. Supply the last observed `p_expected_version`.
- `settle`, `reopen`, `delete` (void), `restore`: payer, creator or active household host; supply `p_expected_version`. Restore clears void metadata and preserves payment/settlement facts. Other changes to a voided record require restoring it first.
- `repay`: operates only on the authenticated actor's positive non-payer share. Optional `payload.amountCents` is a positive integer no larger than their remaining share; omission pays the remaining share. Optional `payload.date` is a strict `YYYY-MM-DD` payment date; omission uses household-local today with UTC fallback. A recorded date and the server audit timestamp are distinct.
- `undo_repay`: optional `payload.paymentId` reverses that active own payment; omission selects the latest active own payment. It never deletes the record or reverses another participant's payment. No expected version is required for either payment action; unrelated facts are merged atomically under the row lock. A payload cannot target another person.
- `reopen` removes the manual settlement flag and preserves actual repayments. If all positive shares are repaid, it remains automatically settled. A participant can subsequently undo their own acknowledgement. `undo_repay` is rejected while manually settled; reopen first. Recording an actual own repayment remains possible while manually settled.
- The same operation UUID may be retried only by the same actor with exactly the same household, expense, action, payload and expected version. Reusing it for another request is rejected. Unknown-commit timeouts retain that UUID on retry.

Cents are canonical, positive and within JavaScript's safe integer range. Each unique participant has one nonnegative integer allocation; allocations must sum exactly to the total. Create and financial edits require active participants/payer. Display `amount` and dollar `splits` are derived from cents, so inconsistent caller aliases cannot inflate debt. Date is strictly `YYYY-MM-DD`. Zero debtor shares do not require repayment or block settlement. A payer-only expense has no outstanding debt.

Household, creator and Shopping source identity are immutable. After any payment record (including a reversed one), settlement or void, amount, payer, participants, allocations, date and split mode remain locked permanently; safe descriptive changes remain creator-only. A Shopping conversion's total cents are always immutable; payer/splits/date may be changed before a payment or settlement. For the narrowly defined older payer-only record with one participant equal to the payer, no allocation field and empty/absent dollar splits, migration 003 derives that payer’s covered total. This adds no roommate obligation and preserves the total, payer, participants and date; actual debtor terms or existing allocation/payment facts are never inferred or replaced. Controlled backfill disables only the expense write guard under the exclusive transactional table lock, then reenables it; a failed migration rolls the trigger state back. Migration 002 infers legacy `manuallySettled` metadata. Migration 003 imports each old true non-payer paid flag as a full-share ledger payment once, preserving actual cent balances, manual settlement and row versions. Imported records have `legacy:true`; their date is the old recorded update day in UTC because the actual payment date was never stored. Import activity is explicitly labelled, has no invented actor and does not pretend to reconstruct unavailable edit history.

Version conflicts use SQLSTATE `40001` and require refresh/review before a new edit/void/restore/settle/reopen operation. They are not a transient network retry of the stale intent. Authorization uses `42501`; deleted/missing and duplicate/source errors are surfaced explicitly. A failed transaction leaves no success receipt or partial source claim.

## Payment projection and household activity

`entry.repaymentCents` is the authoritative map of active paid cents by participant. `entry.repayments` is the server-derived chronological array `{id, actorId, amountCents, date, recordedAt, legacy, reversedAt?, reversedBy?}`. A reversed record remains visible and contributes zero active paid cents. `paidBack` is a compatibility alias derived only for a fully repaid positive non-payer share. Clients cannot replace these fields. `financialHistory` remains true after reversing every payment or reopening settlement, so corrections do not unlock financial edits.

Read activity using `public.expense_activity` filtered by `household_id`, ordered by `created_at desc,id`, with normal pagination. Fields are `id`, `household_id`, `expense_id`, `actor_id` (null for import), `action`, `amount_cents`, `payment_id`, `summary`, `created_at`. Actions are `create`, `update`, `repay`, `undo_repay`, `settle`, `reopen`, `void`, `restore`, `import`. One successful RPC operation emits one event; idempotent retries add neither a payment nor an activity event. Activity stores a descriptive summary and relevant amount/reference, never a private outbox payload. The table is published to Realtime with household-read RLS; expense updates continue carrying the payment projection.

## Shopping conversion contract

`shoppingSource.type` is `shopping-item` or `shopping-list`; `shoppingListId` must reference an authoritative list in the household. An item source has exactly one `shoppingItemIds` element belonging to that list and household. If the item's server price is present, the expense must equal that price in cents. An unpriced item may use the manually entered positive total.

A list source has one lifetime purchase cycle. The server derives its item IDs and name, checks `listTotalCents` against the floor of known authoritative item prices, subtracts the **durable** individual item claim total, and requires the expense amount to equal the remainder. Unpriced items are supported by entering a list total at least as large as the known-price floor; the server does not claim to verify an external receipt. Create a new list for another shopping trip.

An individual conversion also writes the item's `entry.convertedExpenseId` in the same transaction as the claim and expense, without changing its completed state. This link survives an outbox acknowledgement after app restart; claims remain the authoritative duplicate protection if a legacy Shopping snapshot subsequently drops its link. A completed list conversion prevents later item conversions on the same list. Voiding an expense or deleting a Shopping row never releases its claim; restore reuses the retained expense rather than charging again. Historical sources already recorded in `entry.shoppingSource` are backfilled; duplicate historical item sources reserve their combined amount without silently deleting or refunding existing IOUs. Historical conversions that never recorded any source identity cannot be reconstructed automatically and need separate review if suspected.

## Build 42 compatibility and rollout

Build 42 submits whole expense rows and unversioned DELETEs. Its snapshot contains no trustworthy original server version, so a timestamp cannot prove that an edit is current. The compatibility trigger therefore:

- allows fresh, authorized legacy creates, but rejects pre-cutover historical-cache bootstrap;
- allows only the authenticated participant's additional positive repayment facts and authorized whole-expense settlement;
- merges true payment facts and preserves settlement instead of replacing them from stale snapshots;
- skips UPDATE entirely when a snapshot adds no new fact, avoiding Realtime echo/version churn;
- rejects direct financial/descriptive edits and every direct DELETE, requiring the updated client;
- blocks a legacy repayment flag after that actor explicitly used `undo_repay`, and blocks legacy manual settlement after `reopen`. These durable barriers are independent of client clocks. Explicit updated-client operations remain available.

These restrictions intentionally mean **old-client Edit/Delete require an update**, and corrected repayment/settlement facts must subsequently use the updated app. Migration 003 retains safe legacy writes by translating an accepted full-paid acknowledgement into only the remaining ledger cents, without replacing prior partial records. Old snapshots cannot erase a partial history or act on a voided record. However, build 42 cannot display partial amounts or voided balances accurately: require the compatible ledger-aware client before making those features available. Existing data is preserved. The November 8 rollout completed a full rollback-only rehearsal against live data before applying both exact migration files in one guarded transaction and recording their history. The committed schema, function grants, row security, triggers, Realtime configuration and ledger projection were independently checked. Existing expense identities, totals, recorded paid cents and nonpayer obligations were preserved. PostgREST recognizes the new column and routes, with anonymous access denied on restricted tables. Existing installed clients must update to build 43 before using partial payments or void/restore. Subsequent migrations must continue using transactional rollout and a compatible-client plan.

## Verification

Run the meaningful database tests with disposable dependencies outside the repository:

```sh
npm install --prefix /tmp/sweetmate-db-tests @electric-sql/pglite@0.5.15 embedded-postgres@18.6.0-beta.19 pg@8.23.1
node scripts/expenses/test-database.mjs /tmp/sweetmate-db-tests/node_modules/@electric-sql/pglite/dist/index.js
node scripts/expenses/test-payments-database.mjs /tmp/sweetmate-db-tests/node_modules/@electric-sql/pglite/dist/index.js
node scripts/expenses/test-concurrency.mjs /tmp/sweetmate-db-tests/node_modules
```

Local run used the already-present `/private/tmp/sweetmate-chore-db-tests/node_modules` dependency directory. The 002 historical suite, additive 003 suite and combined native concurrency suite passed. The native suite initializes disposable PostgreSQL bound to `127.0.0.1:55482`, uses synthetic users/records and removes its temporary database. It never loads Supabase credentials. A sandbox that forbids PostgreSQL shared memory or localhost binding needs approval for this local test command, not production access.

Validated using real migrations: active/former/outsider role matrix; legacy null-creator authorization; canonical money/date/type validation; immutable identities; optimistic versions; own positive repayments/undo; payer/host settlement; reopen preserving payments; zero shares; source ownership/price/remainder/uniqueness; historical source and manual-state backfill; persistent tombstones; receipt replay after update/delete; private-table/helper permissions; expected-actor protection; actual owner-only household RPC cleanup across expenses/private tables; safe legacy creates; rejected edits/deletes; no-op snapshot suppression; correction barriers despite future client timestamps. The additive 003 suite also validates imported balances/versions, partial payments/payment dates, targeted reversals, permanent financial locks after full reversal, recoverable void/restore, read-only activity and legacy ledger compatibility. Native multi-session tests additionally hold transactions open to verify independent repayments, duplicate create retries, competing source conversions, mixed old/new UPDATE and ON CONFLICT contention, stale-version settlement, stale legacy repayment/settlement arriving during undo/reopen, concurrent partial amounts/overpayments, one-event payment retries, and stale void intent racing with a reversal.

Final validation of the expense repairs and six client improvements passed: repository `pnpm run typecheck`, the complete `@workspace/mobile` test suite (including partial/void balances, freshness, durable draft recovery, exact retry intents, captured editor versions and actual screen/mutation callback regressions), and Expo web export. Commands used `--config.verify-deps-before-run=false` for the local pnpm installation. Frontend tests cover operation/outbox/hydration/recovery and UI regressions separately; the UI callback tests establish state and wiring, not physical iPhone presentation.

## Release verification

- EAS build `7c218625-5156-46af-8e71-8c68b0d36b66`: FINISHED; version 1.0.0, build 43.
- EAS submission `0f54e692-c421-490f-88e3-3c8bce89a2a0`: FINISHED.
- Apple processing: VALID; internal state IN_BETA_TESTING; external state READY_FOR_BETA_SUBMISSION. External beta review was not submitted.
- The uploaded archive matched all 247 tracked mobile files from the app source commit and contained no private environment files. Unrelated local work was restored and hash-verified.

## Remaining verification and follow-up

Deployed schema, constraints, function grants and Realtime publication metadata are verified. Use internal TestFlight build 43 to test two actual accounts/devices through online/offline/reconnect, lost-response retry, app restart, household switching, partial payments, activity, void/restore and simultaneous repayments. Verify native iOS Details → confirmation/edit dismissal, large text/long participants, saving/errors and touch targets on device before broader distribution; automated SQL and UI callback checks do not establish native presentation or device delivery.

`expenses.paid_by` still has the existing `auth.users ON DELETE RESTRICT` foreign key. Account deletion therefore needs a separate deliberate policy for retained shared financial history/anonymization and a transaction-level integration test. This repair does not drop that protection or silently remove other household members' expense history.
