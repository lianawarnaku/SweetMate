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
