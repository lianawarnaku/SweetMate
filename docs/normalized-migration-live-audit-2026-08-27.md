# Normalized migration live audit — 2026-08-27

Project: Supabase production branch linked by this repository.

## Pre-deployment observations

- `household_states.state->'chores'`: 35 total records.
- `public.chores`: 7 records.
- Missing normalized chore IDs: 28.
- Normalized chore orphans: 0.
- Blob expenses: 4; legacy `public.expenses`: 0.
- Blob shopping lists/items: 5/12; legacy tables: 0/0.

The expenses and shopping tables came from the abandoned UUID-based schema in
`phase4-migration.sql`; their columns and foreign-key identity did not match the
current client model. The normalized migrations contain row-count guards and
will refuse to replace those schemas in any environment where they are not
empty.

## Read-only audit query

```sql
select jsonb_build_object(
  'chore_rows', (select count(*) from public.chores),
  'blob_chore_rows', (select coalesce(sum(jsonb_array_length(coalesce(state->'chores', '[]'::jsonb))), 0) from public.household_states),
  'expense_rows', (select count(*) from public.expenses),
  'blob_expense_rows', (select coalesce(sum(jsonb_array_length(coalesce(state->'expenses', '[]'::jsonb))), 0) from public.household_states)
);
```

No orphan cleanup was executed because the preview returned zero chore orphans.

## Deployment and browser verification

- Applied migrations `202608260005` and `202608270001` through `202608270004`
  to the linked production project.
- The one-time all-household backfill produced 61 chores, 4 expenses, 5
  shopping lists, and 12 shopping items. Every remaining blob entity ID was
  present in its normalized table; the missing counts were all zero.
- The remaining-blob chore orphan preview returned zero, so no cleanup DELETE
  was run.
- Opened the web client at `localhost:8081` with its existing authenticated
  session. Normalized hydration populated the active household without a
  Supabase runtime error.
- Created `[migration test] one-off`, completed it, uncompleted it, and queried
  its normalized row after each high-value transition.
- The first deletion attempt exposed a duplicate-confirmation UI defect. Commit
  `e86c1a3` consolidated confirmation handling. Repeating the browser flow then
  removed the record from both the UI and `public.chores` (`count(*) = 0`).

Browser console output contained React Native Web deprecation/nesting warnings,
but no normalized-table or Supabase synchronization error. A second household
account was not available in the browser session, so host/non-host pickup,
reassignment, and cross-account Realtime remain unverified manually.
