-- Dormant recurring series no longer create an individual row for every
-- never-materialized occurrence that is already outside the incomplete-chore
-- archive window. Existing rows are preserved; this date records the oldest
-- unmaterialized date the client may consider creating in future passes.
alter table public.chores
  add column if not exists materialization_starts_on date;
