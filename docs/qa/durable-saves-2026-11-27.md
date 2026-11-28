# Durable saves and termination audit — 2026-11-27

> Follow-up: the reviewed durable-operation migration is now deployed in production. The historical local-only statements below describe this audit run; see the [current rollout and device limits](../release/public-release-readiness-2026-11-27.md).

Implemented in the canonical `main` checkout. Existing uncommitted work is preserved. No production migration, release, TestFlight build, purchase, live Google request, or email was sent.

## What changed

The singleton Supabase client now journals supported app mutations to account-scoped AsyncStorage **before sending**. Reopening the same account resumes those operations. Switching accounts never replays the previous account's journal with the new credentials. The existing financial outbox remains separate and uses its existing operation receipts.

Each queued REST mutation keeps a stable UUID and an explicit desired value. The new `execute_app_operation` function commits the change and its receipt in the same transaction. Replaying a committed ID returns its original result; a different payload under that ID is rejected. Simultaneous duplicate requests serialize using a transaction-scoped advisory lock. The function runs as the caller, preserving existing RLS, column grants, and business validation. [PostgreSQL advisory-lock reference](https://www.postgresql.org/docs/current/functions-admin.html).

The transport supports a narrow list of app tables and mutating RPCs; unknown mutations fail closed. A source inventory test makes new write targets or RPCs require an explicit policy. The app never falls back to an unjournaled write if the receipt endpoint is missing.

Chore completion and its points snapshot are staged as a single transaction. Pickup rewards are computed before staging that transaction. Retrying a queued operation does not call the completion action, award points again, regenerate a recurrence, or repeat analytics/celebration callbacks.

Rapid follow-up choices reach disk while an older network request is still pending. Google check/undo staging explicitly covers that case. The old delayed shared-snapshot writer no longer waits behind a 220 ms UI timer. The checkmark and existing motion/haptic callbacks still happen immediately, independently of network completion.

Pending notices are restored from the journal. An unacknowledged cold-start journal must sync before a stale server snapshot can replace it. Recovery refreshes affected data. Active-session request cancellation stops waiting without dropping a staged write. Requests remain bounded, failed queues remain usable, rejected operations are not retried automatically on foreground, and a newer corrected choice on the same resource supersedes a confirmed rejection.

Feedback, Google chore export, and disconnect requests also have durable intent. Their existing stable request/event IDs make replay safe. OAuth connection requests and auth passwords/tokens are excluded from the journal.

Apple Reminders exports use a separate account-scoped journal. If EventKit created a reminder before the local mapping was saved, retry first looks for the stable chore marker. A failed lookup never blindly creates another reminder. Launch recovery only reads existing permission status; it never opens a permission prompt.

The journal stores app mutation payloads, not Authorization headers or credentials from auth/OAuth flows. Acknowledged operations are removed from the device journal. Account deletion clears both journals and the existing expense outboxes. Server receipts cascade on account deletion; their returned representations otherwise remain available for replay while the account exists.

## Verification

- `pnpm run typecheck`: passed across the workspace.
- `pnpm --filter @workspace/mobile run test`: **109/109 programs passed**. Added actual pickup-callback assertions also passed after the final implementation.
- Local Expo exports for web, iOS, and Android: passed. These are bundle checks, not native installations or distribution builds.
- Inventory check: 28 RPC names and 12 concrete table-write targets have explicit durable/specialized policies. Dynamic collection tables use the same whitelist.
- `git diff --check`: passed.

### Real process termination against the local database

**82 mutation cases passed** using disposable accounts and the existing local Supabase Auth, PostgreSQL, PostgREST, RLS, grants, and RPCs. Each case uses the production persistence engine in a fresh Node child process with filesystem-backed storage:

1. Finish the journal write, halt before sending, and kill the child with `SIGKILL`.
2. Start a new process, let the server commit, halt before the persistence engine receives success, and kill it again.
3. Start another process and replay the original operation ID. Verify acknowledgement removes it from disk and does not create another receipt. Financial actions also verify exactly one activity entry.

Representation-returning saves must actually return a saved row. Completion and pickup snapshots retain 5 and 30 points respectively through replay. Additional checks passed for concurrent duplicate requests, changed-payload rejection, cross-account/RLS denial, anonymous nudge sender protection, full batch rollback, action whitelisting, and replay that leaves a newer peer update intact.

| Mutation case | After journal / before send | After commit / before acknowledgement | Recovery |
| --- | --- | --- | --- |
| create household | SIGKILL | SIGKILL | Passed |
| join household | SIGKILL | SIGKILL | Passed |
| household preferences bootstrap | SIGKILL | SIGKILL | Passed |
| finish setup | SIGKILL | SIGKILL | Passed |
| generated task settings | SIGKILL | SIGKILL | Passed |
| seed difficulty | SIGKILL | SIGKILL | Passed |
| difficulty edit | SIGKILL | SIGKILL | Passed |
| difficulty reset/delete | SIGKILL | SIGKILL | Passed |
| member preference | SIGKILL | SIGKILL | Passed |
| member name/color | SIGKILL | SIGKILL | Passed |
| chore create | SIGKILL | SIGKILL | Passed |
| edit and reassign chore | SIGKILL | SIGKILL | Passed |
| bulk create chores | SIGKILL | SIGKILL | Passed |
| chore complete | SIGKILL | SIGKILL | Passed |
| undo chore | SIGKILL | SIGKILL | Passed |
| household snapshot/points/custom tasks | SIGKILL | SIGKILL | Passed |
| atomic completion + points | SIGKILL | SIGKILL | Passed |
| pickup reward completion transaction | SIGKILL | SIGKILL | Passed |
| household activity and sleep status | SIGKILL | SIGKILL | Passed |
| essential owned preference | SIGKILL | SIGKILL | Passed |
| custom task deletion | SIGKILL | SIGKILL | Passed |
| shopping list create/edit | SIGKILL | SIGKILL | Passed |
| shopping item create/check | SIGKILL | SIGKILL | Passed |
| pin shopping list | SIGKILL | SIGKILL | Passed |
| assign shopping list | SIGKILL | SIGKILL | Passed |
| schedule shopping list | SIGKILL | SIGKILL | Passed |
| reorder shopping list | SIGKILL | SIGKILL | Passed |
| uncheck shopping item | SIGKILL | SIGKILL | Passed |
| assign shopping item | SIGKILL | SIGKILL | Passed |
| edit shopping quantity | SIGKILL | SIGKILL | Passed |
| reorder shopping item | SIGKILL | SIGKILL | Passed |
| mark shopping conversion | SIGKILL | SIGKILL | Passed |
| shopping item delete | SIGKILL | SIGKILL | Passed |
| shopping list delete | SIGKILL | SIGKILL | Passed |
| private borrowing create/edit | SIGKILL | SIGKILL | Passed |
| edit private borrowing | SIGKILL | SIGKILL | Passed |
| private borrowing return | SIGKILL | SIGKILL | Passed |
| private borrowing delete | SIGKILL | SIGKILL | Passed |
| shared borrowing create/return | SIGKILL | SIGKILL | Passed |
| edit shared borrowing | SIGKILL | SIGKILL | Passed |
| return shared borrowing | SIGKILL | SIGKILL | Passed |
| shared borrowing delete | SIGKILL | SIGKILL | Passed |
| essential self assignment | SIGKILL | SIGKILL | Passed |
| essential self unassignment | SIGKILL | SIGKILL | Passed |
| essential shortlist | SIGKILL | SIGKILL | Passed |
| nudge send (server-generated ID) | SIGKILL | SIGKILL | Passed |
| nudge read | SIGKILL | SIGKILL | Passed |
| nudge dismiss | SIGKILL | SIGKILL | Passed |
| nudge remove | SIGKILL | SIGKILL | Passed |
| recurrence occurrence claim | SIGKILL | SIGKILL | Passed |
| propose chart | SIGKILL | SIGKILL | Passed |
| revise chart | SIGKILL | SIGKILL | Passed |
| approve chart owner | SIGKILL | SIGKILL | Passed |
| approve chart member | SIGKILL | SIGKILL | Passed |
| apply approved chart | SIGKILL | SIGKILL | Passed |
| restart chart (one new chart/notification) | SIGKILL | SIGKILL | Passed |
| force approve chart | SIGKILL | SIGKILL | Passed |
| cancel charts | SIGKILL | SIGKILL | Passed |
| restart alert read | SIGKILL | SIGKILL | Passed |
| random task create/assignment | SIGKILL | SIGKILL | Passed |
| random task claim | SIGKILL | SIGKILL | Passed |
| configure Google household calendars | SIGKILL | SIGKILL | Passed |
| Google busy sharing | SIGKILL | SIGKILL | Passed |
| disable Google busy sharing | SIGKILL | SIGKILL | Passed |
| Google event check | SIGKILL | SIGKILL | Passed |
| Google task check | SIGKILL | SIGKILL | Passed |
| Google task undo and time edit | SIGKILL | SIGKILL | Passed |
| Google task clear time | SIGKILL | SIGKILL | Passed |
| disable Google calendar sources | SIGKILL | SIGKILL | Passed |
| chore delete | SIGKILL | SIGKILL | Passed |
| expense create | SIGKILL | SIGKILL | Passed |
| expense update | SIGKILL | SIGKILL | Passed |
| expense repay | SIGKILL | SIGKILL | Passed |
| expense undo_repay | SIGKILL | SIGKILL | Passed |
| expense settle | SIGKILL | SIGKILL | Passed |
| expense reopen | SIGKILL | SIGKILL | Passed |
| expense delete | SIGKILL | SIGKILL | Passed |
| expense restore | SIGKILL | SIGKILL | Passed |
| leave household | SIGKILL | SIGKILL | Passed |
| rejoin household | SIGKILL | SIGKILL | Passed |
| remove household member | SIGKILL | SIGKILL | Passed |
| delete household | SIGKILL | SIGKILL | Passed |

[Database run output](durable-saves-2026-11-27/database-termination.txt)

### Provider and native models

Three additional process-termination cases passed over real loopback HTTP with the actual feedback and Calendar service handlers: feedback submission, Google chore export, and Google disconnect. Google and email services were replaced with deterministic in-memory providers. An existing exported event is reused after its acknowledgement is lost; feedback keeps its request ID. No message was sent and no live Google account was accessed.

The iOS reminder test discards module/queue memory between runs while retaining modeled OS records and storage. It verifies recovery after creation but before mapping, stable-marker reuse, no duplicate creation after a failed lookup, no startup permission prompts, and no cross-account replay.

[Provider run output](durable-saves-2026-11-27/provider-termination.txt), [check summary](durable-saves-2026-11-27/checks.txt).

All disposable termination-audit accounts and households were removed. Temporary credential/configuration files and test journals were removed. Existing QA services and real households were preserved.

## Limits and remaining device checks

- These are **real child-process kills**, not force-quits of an installed SweetMate app on a physical iPhone or Android phone. Native AsyncStorage/EventKit behavior, OS scheduling, airplane-mode recovery, and the visible restored notice still need device verification. The browser/jiggle verification from the earlier save-feedback audit remains relevant; no new visual device claim is made here.
- Durability begins when the device storage write finishes. Termination before that acknowledgement, a full/corrupt storage device, uninstalling the app, clearing app data, or losing the phone cannot be guaranteed to preserve unsent work. Storage failures never trigger an unjournaled network write. Unsubmitted form text is not an accepted mutation and is not covered by this queue.
- The tests cover the mutation boundary and listed action payloads, not every screen/gesture, field combination, permission state, or timing interleaving. This does not make the entire app bug-free.
- Live Google OAuth, refresh/revocation outages, email delivery, Apple account confirmation, push delivery, and real Reminders were not exercised. Interrupted password/OAuth/deletion confirmations must resume their secure flow; secrets are intentionally not stored for blind replay. Push registration already re-registers a stable installation/token on launch and is not placed in this user-mutation journal.
- EventKit does not offer a transactional client-supplied unique reminder ID. Marker lookup protects the tested recovery path; physical-device verification remains necessary. Legacy reminders without either a saved mapping or the new marker cannot be reliably identified after that mapping is lost.
- Local appearance/display preferences already use account-scoped local storage; they do not get server-operation receipts. Native storage persistence needs the same device check after its write completes.
- The journals assume one running app instance per account on a device. Separate devices have separate journals. Simultaneous same-account web tabs sharing one storage area are not a cross-tab transactional outbox.
- Household scores remain part of a shared document. Replaying the **same operation** is duplicate-safe; this is not a transactional score ledger for independent concurrent actions by different devices. Retained unsaved rejections may require correcting the original form or restoring access before an explicit retry.

## Deployment requirement

Apply `supabase/migrations/202611270001_durable_app_operations.sql` before distributing an app build containing this transport. It has been applied and tested **only locally**. If that endpoint is absent, the new client keeps the operation pending instead of bypassing duplicate protection. The prior locally pending reliability migrations remain separate release prerequisites.

No production backend or installed TestFlight app was changed by this task.
