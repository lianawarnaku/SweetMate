# Chore chart database validation

`202611080001_chore_chart_integrity.sql` is an additive migration for the preference-based chart pipeline. Apply it before deploying the new chart UI. This work prepares the migration; the test scripts do not apply anything to a connected Supabase project.

The migration makes personal preferences writable only by their member, makes proposal snapshots and votes read-only through the table API, and routes votes through membership-checked RPCs. Every proposal transition and chart application locks the household before locking its proposal. One pending proposal per household is enforced by an index. Payload validation checks active roster coverage, unique task assignments, supported cadence, difficulty, calculated workload, and cumulative pins/exclusions. Membership changes require rebuilding a stale proposal.

`apply_approved_chore_chart(target_chart_id uuid, chore_rows jsonb)` accepts full snake_case normalized `ChoreRow` objects from the shared materializer. It accepts one anchor per approved task, checks task fields/assignment/rotation eligibility, commits all rows atomically, and records `proposed_charts.applied_at` for harmless retries. A superseded approved chart cannot apply. Newly generated anchors start no earlier than household-local tomorrow and must use that date as `materialization_starts_on`. Existing manual assignment locks retain their dates, owner, and recurrence series. The `assignment_locked` flag represents an explicit chore edit, while generated Always rules remain in the proposal payload and use a specific person without that flag; a later Never rule can therefore replace their future assignments. Completed history, manual chores, and overdue work remain intact.

Replacement retires previous generated series with an exclusive cutoff at household-local tomorrow and deletes only their unfinished future rows. A server-owned `retired_chore_series` ledger prevents offline clients from clearing that cutoff or reinserting removed future unfinished rows. Offline completion facts may still sync, and an existing completed fact can still be explicitly undone. Series containing unfinished manually locked chores remain intact. Initial household setup can continue inserting its first chores directly.

Existing legacy proposals without `version: 2` must be rebuilt. The creator's initial vote remains false, so the app presents the proposed chart for review before the creator approves it. New difficulty seeds preserve existing household overrides.

## Disposable PostgreSQL tests

Install test-only dependencies outside the repository:

```sh
npm install --prefix /tmp/sweetmate-db-tests --no-audit --no-fund @electric-sql/pglite embedded-postgres pg
```

Run the real migrations and RLS/RPC regression tests in an in-memory PostgreSQL WASM instance:

```sh
node scripts/chores/test-database.mjs /tmp/sweetmate-db-tests/node_modules/@electric-sql/pglite/dist/index.js
```

Run the same regressions in a temporary native PostgreSQL cluster, plus the actual production builder/materializer and separate database connections contending on final votes, replacements, and application:

```sh
node scripts/chores/test-concurrency.mjs /tmp/sweetmate-db-tests/node_modules
```

The native server binds to localhost, creates its data in a new temporary directory, and stops/removes that directory on completion. Neither script reads project credentials or touches production. Regression coverage includes preference upserts and impersonation attempts; proposal/vote privilege bypasses; malformed task/member/load/constraint payloads; active voters and owner override; stale roster rejection; atomic failure rollback; approved application; pins and exclusions; history and manual-lock preservation; offline stale upserts; supported cadence/category constraints and seeds; application retries; and simultaneous final-vote/replacement/apply transactions.
