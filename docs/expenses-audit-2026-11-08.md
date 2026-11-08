> Historical audit of commit `7836c88`. The approved repairs and deployment status are documented in [Expenses repair](expenses-repair.md).

# SweetMate Expenses audit — November 8, 2026

Audited source: canonical `main` commit `7836c88`, matching TestFlight 1.0.0 (42).

This was a read-only review. No application code, repository tests, database records, policies, builds, or releases were changed. Exploratory scripts were written only under `/private/tmp` and use synthetic records and mocked storage/Supabase. Existing unrelated feedback work remains untouched.

## Conclusion

There are concrete explanations for the reported unresponsive buttons: the payer can see a settlement action that its own permission check rejects, long-press leaves a flag that discards the next tap, and Details requests a second native confirmation modal without closing itself. The iOS presentation consequence is strongly indicated by the native presentation path but was not reproduced on a physical device.

There are also higher-impact persistence and accounting problems. Actual extracted sync-hook tests reproduced lost settlements, overwritten independent repayments, an unwanted delete of a newly inserted expense, and resurrection of a deleted expense from stale cache. These results demonstrate reachable code behavior with controlled timing; they do not establish that any particular live expense was affected.

## Priority findings

### 1. High — Settle can be shown to a user who cannot execute it

The list displays its checkmark when `paidBy === currentUserId`. The domain permits the creator or host to manage an expense, with payer permission only as a fallback for legacy records lacking creator ID. When Alice logs an expense paid by Bob, non-host Bob sees Settle but `settleExpense()` returns false. The callback ignores that result and triggers a success haptic.

Evidence: `app/(tabs)/expenses.tsx:808`, `:814`; `context/AppContext.tsx:3877`, `:3923`.

Recommendation: define one action policy and use it in UI, domain and database. Recommended policy: payer/creditor, creator and host can settle the entire IOU; each participant can record only their own repayment. Editing can remain creator-only. Handle rejected/no-longer-available/already-completed actions explicitly and confirm success only after the write succeeds.

Confirmed with actual extracted callbacks. Details also continues to show Settle all on an already-settled expense, producing another rejected/no-change action with success feedback.

### 2. High — Detail confirmations compete with an already-presented native modal

Details is a native React Native Modal. Its I paid, Settle all and Delete buttons invoke the global popup provider, which presents another sibling native Modal while Details remains visible. The action is deferred until that confirmation is accepted. Suppressed confirmations bypass the popup and execute immediately, so behavior can differ between users.

Evidence: `expenses.tsx:1007`, `:1133`, `:1193`, `:1204`; `hooks/useConfirm.ts:25`; `components/AppPopupProvider.tsx:73`.

Recommendation: render confirmation within the existing modal, or close Details and queue the next presentation after native dismissal. The Edit action also uses a zero-delay timer after closing the slide modal (`expenses.tsx:1183`); the action menu uses another timer (`ActionMenuModal.tsx:106`). A timer does not establish that native dismissal has finished. React Native provides an iOS `onDismiss` callback for completed dismissal: [official documentation](https://reactnative.dev/docs/modal#ondismiss).

Confirmed: conflicting modal state and callback ordering. Not yet confirmed on a physical iPhone: whether the second modal is hidden, presentation is refused, or a particular transition freezes.

### 3. High — Save failures are reported as local success

Create, edit, settlement, repayment and deletion first change local arrays. A separate effect sends changes to Supabase. Save errors are logged; the initiating screen receives no server result, rollback or visible retry state. The creator sheet can close, or a settlement can animate, despite a failed database write.

Evidence: `AppContext.tsx:860`, `:866`, `:875`, `:3847`, `:3923`, `:3945`.

Recommendation: awaited expense mutations with saving/saved/failed states. Preserve offline changes in a durable outbox with explicit retry and reconciliation. Success animation/haptics should represent a successful transition with clear pending state while saving.

Actual-hook reproduction: local settled=true, simulated server settled=false after a failed write, with no autonomous retry.

### 4. High — An older queued snapshot can delete another person's new expense

A queued save closes over an older `entities` array. It later compares that array with the latest shared persisted-row map. A Realtime insert can add a new expense to that map while a prior network request holds the queue. The older array does not contain the new ID, so the planner treats it as a deletion and issues a DELETE.

Evidence: `AppContext.tsx:835`, `:862`, `:875`; `lib/normalizedCollection.ts:19`.

Actual-hook reproduction: hold write A; queue older snapshot B containing e1; receive Realtime INSERT e2; release A; B executes DELETE e2. A later snapshot can reinsert e2, but an unwanted deletion has occurred.

Recommendation: explicit per-record create/update/delete operations, deletion intents/tombstones and server version checks. Absence from an old snapshot must not mean deletion. This shared hook has other consumers that need regression coverage if its behavior changes.

### 5. High — Concurrent repayments overwrite each other

Repayment copies the current `paidBack` object, then saves the entire expense JSON. Two devices starting from the same record can submit `{alice:true}` and `{bob:true}`. Whole-row replacement keeps one acknowledgement and loses the other, making already-paid debt appear outstanding again.

Evidence: `AppContext.tsx:3952`, `:867`; `lib/expenseRow.ts:16`; `lib/normalizedCollection.ts:30`.

Recommendation: an atomic server operation for one participant's repayment, or separate repayment records with idempotency and audit information. Never replace unrelated participants' acknowledgements with a client snapshot.

Confirmed with actual hook/helpers and synthetic concurrent updates.

### 6. High — Initial loading can overwrite a payment made from cached data

Cached expenses can be visible while the normalized initial query is pending. When nonempty rows arrive, the hook replaces local expenses outright, regardless of newer local edits or pending settlement.

Evidence: `AppContext.tsx:808`, `:1596`.

Actual-hook reproduction: settle a cached expense before initial fetch resolves; return the older unsettled server row; the local settlement disappears without being persisted.

Recommendation: preserve/merge pending operations into initial hydration. If mutation must wait for loading, expose an explicit loading state and explain why actions are unavailable.

### 7. High — Server authorization and canonical money validation are incomplete in repository SQL

The expense migration allows any authenticated household member to insert, update and delete household expense rows. It does not enforce creator/host editing/settlement rules or participant-only repayment. `markPersonPaid()` also has no acting-user authorization check. The normal UI passes the current user, but that is not a domain or server guarantee.

Evidence: `supabase/migrations/202608270001_expenses_table.sql:33`; `AppContext.tsx:3945`.

There are multiple money representations: amount, amountCents, splits and allocations. The domain validates allocations only when present and does not ensure dollar splits match them. An isolated domain probe accepted a valid $100 allocation object alongside an inconsistent split claiming $1 million. The normal form derives consistent fields; the boundary does not guarantee consistency.

Recommendation: server-authorized expense operations, immutable actor/household fields, active-member checks, and one canonical integer-cent allocation structure. Derive display splits from that source. [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

Confidence: confirmed repository behavior. Current deployed policies and constraints could not be queried with the available read-only connections; live permission state remains unverified.

### 8. High — Editing a paid or settled expense can hide newly added debt

The edit form changes payer, amount, participants and splits while preserving prior paidBack/settled values. Increasing a previously paid share from $30 to $50 keeps paidBack=true and reports nothing owed. Changing a settled expense from $100 to $200 leaves it settled.

Evidence: `expenses.tsx:539`; `AppContext.tsx:3915`.

Recommendation: lock financial fields after any repayment or settlement until an explicit correction/adjustment flow exists. Continue allowing safe descriptive edits. Record actual repayment amounts and adjustments if flexible post-payment editing is required. Blindly clearing paid flags can also be incorrect because money already paid must remain accounted for.

Confirmed using the actual update callback and summary helper.

### 9. High — Shopping conversion lacks durable uniqueness

The duplicate guard only checks active individual-item conversions in current local data. List conversion has no equivalent persisted list-conversion identity, and item conversion is not atomically unique across devices. The save links individual item conversions, but not list conversions.

Evidence: `app/(tabs)/shopping.tsx:397`; `expenses.tsx:516`, `:570`.

Example: a $100 list with $20 already assigned to an individual item can generate the remaining $80 IOU repeatedly.

Recommendation: an atomic shopping-to-expense operation with a unique purchase/source identity, including list remainder conversions, validated against authoritative server state. Define how a later genuinely new purchase cycle reuses the list without duplicating an earlier charge.

Confirmed from source; no live duplicate expenses were created.

### 10. Medium — Stale cache can resurrect the last deleted expense

Every connection interprets an empty normalized table as needing bootstrap and uploads its current cached entities. An empty server table after a legitimate deletion is therefore indistinguishable from an uninitialized table.

Evidence: `AppContext.tsx:813`.

Actual-hook reproduction: server [], cached [e1] -> bootstrap upsert(e1).

Recommendation: a migration-completed marker and explicit deletion records. An empty authoritative table must stay empty.

### 11. Medium — The first ordinary tap after a long-press is swallowed

Long-pressing stores an expense ID. That flag is only cleared inside the ordinary onPress callback. Installed React Native Pressability suppresses onPress after a recognized long-press, so dismissing the menu leaves the flag set. The next ordinary tap clears it and returns; the second tap opens Details.

Evidence: `expenses.tsx:729`, `:735`.

Recommendation: remove the redundant suppression guard or clear it on release/menu dismissal. Confirmed with the actual row callbacks and installed press behavior.

### 12. Medium — Edit is offered to unauthorized users

The long-press menu always includes Edit expense. If the user cannot edit, opening the editor throws an error. Details correctly hides the same unavailable action.

Evidence: `expenses.tsx:973`, `:978`, `:480`.

Recommendation: use the same availability policy on every entry point; explain unavailable actions where useful. Confirmed with actual callbacks.

### 13. Medium — Zero-dollar shares block complete settlement

Zero allocations are valid, but allPaid requires a paid flag for every non-payer key, including a $0 share. Once every real debtor has repaid, balances can show no outstanding debt while the expense remains unsettled. Details can even offer I paid for a zero share.

Evidence: `lib/money.ts:88`; `AppContext.tsx:3953`; `expenses.tsx:1077`, `:1129`.

Recommendation: derive settlement from positive outstanding cent allocations, and hide payment actions for zero shares. Handle payer-only/no-debtor expenses without leaving an outstanding IOU.

Confirmed with the actual repayment callback and summary helper.

### 14. Medium — Equal splitting and disabled Send can feel unresponsive

Typing a new total updates the amount but does not recalculate equal shares until blur or explicit Split evenly. Read-only equal-allocation fields can therefore remain stale while Send is disabled. A tap may appear to do nothing when it first dismisses the keyboard or causes recalculation.

Evidence: `expenses.tsx:1425`, `:1426`, `:1801`, `:1850`.

Recommendation: derive equal shares whenever total/participants change, and show the blocking validation reason next to the action. Confirmed stale allocation state; the exact iOS keyboard first-tap sequence still needs device testing.

### 15. Medium — Expense dates can shift by one day

A SQL date-only string such as 2026-11-08 is parsed as UTC midnight for display, producing Nov 7 in New York. Saving local noon as a UTC ISO timestamp can also change the calendar date in timezones such as Auckland.

Evidence: `expenses.tsx:79`, `:95`; `lib/expenseRow.ts:40`.

Recommendation: store financial dates as YYYY-MM-DD and display them with a date-only parser. Timezone counterexamples were reproduced locally.

### 16. Medium — Recurring expense controls do not create recurring IOUs

Daily/monthly/custom flags are stored, displayed and partly projected in Calendar. There is no durable expense-occurrence generator with independent repayment state per period; custom text is not parsed into an actual schedule.

Evidence: `expenses.tsx:1617`; `lib/calendarItems.ts:176`; expense CRUD in AppContext.

Recommendation: hide the unsupported recurring option for now, or implement explicit recurring expense series and independent occurrences. Do not imply that storing a flag schedules a future IOU.

### 17. Medium — Additional navigation, recovery and layout issues

- You owe excludes paid shares from its total, but its scroll target does not. It can take the user to an already-paid share (`expenses.tsx:301`) instead of the unpaid expense.
- Details has no scroll container or maximum height (`expenses.tsx:1017`, `:2138`). More participants, long notes or large text can put actions outside the available screen.
- The list's settlement check icon is 15 points with 8-point hit slop and no explicit 44-point minimum or accessible action name (`expenses.tsx:810`).
- There is no dedicated repayment/settlement correction or undo workflow.
- Payer-included list chips can use owe/owes wording even for the payer's own covered allocation (`expenses.tsx:895`).
- The seven-day resolution grouping is memoized only on user/expense changes (`expenses.tsx:277`). Crossing the time boundary alone does not refresh the grouping; foreground/time reconciliation should refresh it.

Recommendation: navigate to actual outstanding shares; bound and scroll Details; provide named 44-point controls and visible press/saving states; add deliberate correction actions preserving prior payment information.

No blanket touch-blocking animation or glass layer was found. The form drag responder is on its header, and decorative layers ignore pointer events. The existing jiggle effect does not need to be removed to fix the confirmed logical failures.

### 18. Follow-up risks requiring live or device verification

- Initial fetch precedes subscription and reconnect errors only log; no reconciliation query runs on successful resubscription/foreground (`AppContext.tsx:798`, `:827`, `:845`).
- The shared queue has no rejection recovery or scope generation check (`AppContext.tsx:862`). Thrown errors can poison later queued work; old account/household tasks can survive cleanup. These conditions were not separately reproduced end to end.
- Household-filtered DELETE delivery needs current replica identity/configuration verification. No corresponding expense REPLICA IDENTITY FULL migration was found. Current Supabase documentation describes the required configuration: [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).
- Retained expense references may affect account deletion (`paid_by` uses ON DELETE RESTRICT in the migration). Account-deletion behavior needs a separate live-schema/transaction check before calling this a deployed failure.

## What is already sound

The normal form uses integer-cent parsing and deterministic cent allocation, validates active participants and split totals, and shows validation errors. The net balance summary explicitly keeps offsetting debts outstanding instead of silently settling them. Several repeated local settlement/repayment actions are guarded. These protections should be retained.

Existing money, IOU summary, expense-row, merge and analytics-action tests pass. They cover deterministic calculations, row mapping and sequential transitions. They do not establish correctness of native modal handoff, multi-device writes, loading races, source conversion uniqueness, payment edits, timezone round trips or deployed authorization.

## Verification performed

- Full source tracing of list, Details, action menu, create/edit builder, validation, confirmation provider, permissions, CRUD, cache, normalized synchronization, Realtime, history, recurrence and Shopping handoff.
- Six frontend counterexamples using actual extracted callbacks.
- Six domain counterexamples using actual callbacks/helpers.
- Five persistence counterexamples using the actual extracted hook and a deterministic scheduler with mocked Supabase.
- Existing focused tests reported passing.
- Repository status checked: only the pre-existing unrelated feedback changes remain.

Physical iPhone modal presentation, live database policies/constraints, real multi-account network synchronization, and active production records were not tested or modified.

## Recommended implementation scope for approval

1. Fix modal handoff, long-press tap handling, action availability and honest success/error feedback.
2. Replace expense snapshot synchronization with explicit authorized server operations; add atomic repayments, durable retry/outbox, explicit deletes and safe hydration/reconciliation.
3. Enforce server permissions and canonical integer-cent financial validation. Proposed whole-IOU managers: payer/creditor, creator and host. Participants mark only their own share paid.
4. Prevent duplicate Shopping conversions; protect already-paid financial fields; handle zero shares and corrections deliberately.
5. Repair equal-allocation updates, date-only handling, balance navigation, scrollability and accessible hit areas.
6. Hide recurring expense controls until real independently settleable occurrences are implemented.
7. Add regression coverage for the counterexamples, role combinations, offline/reconnect behavior and native iOS modal transitions before another release.

Roll out database permissions and mutation changes together with a compatible client plan. Build 42 still uses whole-row writes; tightening legacy writes before users have the compatible build could create more failed actions. Preserve existing data during migration and validate at least two accounts/devices, reconnection, old/new client behavior, and failure recovery.

This scope includes application changes and a reviewed expense database migration. None has been implemented or applied. Awaiting the user's approval.
