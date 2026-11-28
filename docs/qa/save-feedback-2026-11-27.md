# Save feedback and retry — 2026-11-27

> Follow-up: durable queues and termination testing were added after this audit. See [the durability report](durable-saves-2026-11-27.md). The active-session-only limit below describes the original implementation.

Implemented locally on `main`; no release, production deployment, purchases, or production data changes.

## Behavior

- Checkmarks and the existing completion motion/haptic callbacks still happen immediately. Network activity does not replace the checkbox with a loading spinner or reload the list.
- A small **Saving changes…** notice appears after 300 ms, avoiding a flash for fast saves. Requests have a 20-second timeout instead of remaining pending indefinitely.
- A failed or unconfirmed write leaves an accessible **Save not confirmed** notice with **Retry**. The wording allows for a server commit whose success response was lost.
- Retry saves the latest explicit choice. It does not replay the completion action, points, recurrence creation, or celebration. Repeated taps and delayed acknowledgements cannot overwrite a newer choice.
- Notices and retry callbacks are isolated by signed-in account and active household. Returning to the foreground retries failed changes for that scope. Existing collection reconnect handling remains in place.
- Chore completion, household snapshot saves, shopping/shared borrowing collection saves, private borrowing returns, and imported Google event/task completion use this feedback. Existing expense command handling and form draft/error flows remain in place.
- Google completion preserves its existing rollback on failure and clearly says the previous checkmark was restored. Retry explicitly sends the intended choice even if a prior server response was lost.
- An open Google item popup owns its notice, preventing a duplicate notice behind the popup. The global notice leaves the floating add button clear.

## Automated checks

- `pnpm run typecheck` — passed across the workspace.
- `pnpm --filter @workspace/mobile run test` — **105/105 passed**.
- Local Expo web, iOS, and Android exports — passed. These were bundle checks, not EAS/TestFlight builds.
- `git diff --check` — passed.

Coverage includes pending delay and accessible Retry UI, failed/repeated retries, stale acknowledgements, rapid check/undo, account/household switches, bounded aborts/timeouts, concurrent collection updates, scope isolation, inline notice ownership, and saved-but-unacknowledged writes. Chore retry tests verify points and generated chore IDs are not duplicated.

## Visual and real local database checks

Used a disposable two-member household with local Supabase Auth, PostgreSQL, REST/RLS, a 390 × 844 browser viewport, and a local fault proxy. No real household or Google account was used. Google provider syncing was stubbed; completion RPCs and persistence were real local database operations.

1. A chore checked immediately while its save was delayed; the delayed notice appeared without blocking the checkmark.
2. A failed household progress save exposed Retry and cleared after success.
3. A failed Google event check restored its previous value, showed the failure inside details, and saved successfully through the actual Retry button.
4. A shopping check remained optimistic, exposed Retry on failure, and persisted after Retry.
5. A private borrowing return remained optimistic and persisted after Retry.
6. A Google task completion committed to the database while the proxy discarded its success response. Retry explicitly recovered the intended state.
7. A delayed Google task check reported both `aria-checked=true` and `aria-busy=true`, with no list reload. On reopening the preview it remained checked, was no longer busy, and showed no save notice.
8. Final database inspection confirmed the chore, shopping item, private return, Google event, and Google task persisted. Chore points remained **5**, including retries.
9. Fixed two visual issues found during testing: the notice overlapped the add button, and a details popup duplicated its notice in the background.

Evidence:

- [Shopping failure with Retry](save-feedback-2026-11-27/shopping-failed.jpg)
- [Single failure notice inside Google item details](save-feedback-2026-11-27/google-detail-failed-final.jpg)
- [Immediate Google checkmark while save is pending](save-feedback-2026-11-27/google-checked-pending.jpg)

The disposable accounts and their household are removed after testing. The temporary preview/proxy server is stopped; existing QA services are preserved.

## Limits

- Feedback and retry intents are held in memory for the active session. This is **not a durable offline outbox**: unsaved changes are not guaranteed to survive app termination or restart. Existing expense queue behavior is separate.
- Tested loaded-session failures and existing reconnect regressions. This does not certify every action taken offline before initial hydration.
- The household snapshot is still a shared document. Avoiding duplicate points during these retries does not replace it with a transactional, concurrent score ledger.
- No live Google OAuth/refresh/provider outage, physical iPhone haptics, VoiceOver, native keyboard, or device gestures were exercised. Native bundle export does not substitute for device testing.
- No production deployment or TestFlight build was made; installed builds do not contain these changes yet.
