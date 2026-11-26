# Shopping lists reappearing after deletion — November 26, 2026

Reported in TestFlight 1.0.0 (54): confirming Delete list removes Sweet Essentials
briefly, then the list returns. The owner confirmed this is resurrection after
confirmation, rather than an unresponsive confirmation button.

## Causes and correction

- The normalized collection queue captured old render arrays. A delayed upsert
  and its realtime echo could restore a list after the local deletion and queue
  another stale write. Queued work now reads current refs, preserves pending
  deletion intent, recalculates deletions after awaited writes, and stops when
  the user/household scope changes. Rejected promises cannot poison the queue.
- Comparing raw JSON transport forms treated server timestamps, JSONB key order,
  and read-time defaults as edits. Comparison now uses the row converters and
  stable writable values, preventing repeated no-op writes and echoes.
- Empty normalized shopping tables were bootstrapped from device cache. They now
  remain authoritative when empty. Only the freshly loaded legacy server document
  may bootstrap Shopping; genuine legacy data is retained. List and item deletion
  update refs immediately, including all child item deletion markers.
- The real local backend did not deliver household-filtered DELETE events with
  its primary-key-only old payload. INSERT/UPDATE remain household-filtered;
  DELETE handling accepts only IDs already loaded in the current household.
  Unknown IDs and stale household callbacks are ignored. RLS/permissions remain
  unchanged and no deleted row content is requested.

Supabase documents the primary-key/DELETE filtering limitations in its
[Postgres Changes guide](https://supabase.com/docs/guides/realtime/postgres-changes)
and [troubleshooting guide](https://supabase.com/kb/troubleshooting/realtime-postgres-changes-troubleshooting).

## Verification

The actual useNormalizedCollection hook is exercised by a controlled React/network
fixture, including JSONB key reordering, server timestamps, missing default fields,
a delayed edit followed by deletion, two members, primary-key-only DELETE payloads,
unrelated household IDs, replayed updates, an empty server with stale device cache,
genuine legacy bootstrap, failed requests, and a household switch during a write.
The initial reproduction confirmed that unchanged hydration queued a write and a
late UPDATE re-added a deleted list.

Live browser checks used only **Interaction Audit Home**, disposable Audit Avery
and Audit Blake accounts, and the local 127.0.0.1:54321 backend:

- Cancel preserved the list; confirming Delete removed it.
- Deleted generated Sweet Essentials Kitchen/Cleaning Supplies lists and their
  children; a direct local database read confirmed Kitchen and its children gone.
- With corrected subscriptions, deletion from Blake immediately removed the
  generated list for Avery too.
- Created and deleted an ordinary QA list; both sessions removed it.
- Reloaded both sessions; deleted lists stayed absent and unrelated Audit groceries
  and remaining lists stayed present. Existing IOU/history records were unchanged.

Required workspace typecheck and full mobile suite passed. Local web export and
iOS/Hermes export passed; git diff --check passed. These are local checks, not a
signed TestFlight build or physical-iPhone verification. Evidence is retained under
/tmp/sweetmate-list-deletion, including verified-shopping-after-reload.jpg.

## Coverage gap and release status

The earlier interaction audit covered source handlers and selected live flows;
it did not establish permanent list deletion through two-member sync and reopening.
Its deletion-event test assumptions did not match the real service. Passing that
audit did not establish that every app button/lifecycle was bug-free. This follow-up
adds the missing real-service check and a matching regression fixture.

Prepared on canonical main. No production records, production schema, or server
configuration changed. Build 54 remains unchanged; a separately authorized native
release and physical-device confirmation are required to deliver this correction
to installed iPhones.
