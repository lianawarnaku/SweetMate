-- Phase 1 of moving chores off the whole-household-snapshot JSON blob and
-- onto normalized rows (see docs/chore-system-audit.md). This table is
-- populated as a shadow copy alongside the existing household_states.state
-- blob for now; the app still reads chores from the blob. Once shadow writes
-- are verified to match, a later migration switches the read path over and
-- retires the chores field from the blob.
--
-- Unlike recurring_chore_occurrence_keys (identity-only claims), this table
-- carries the full chore record and enforces the same occurrence uniqueness
-- directly on the data itself.
--
-- A `chores` table already existed from an abandoned pre-household_states
-- design (uuid ids, none of the recurrence/assignment columns this app
-- actually uses, zero rows, and no code anywhere references it). Confirmed
-- empty and unused before dropping it here to reuse the name.
drop table if exists public.chores;

create table public.chores (
  id text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null,
  description text,
  creator_id uuid references auth.users(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  assignment_mode text not null default 'specific-person'
    check (assignment_mode in ('specific-person', 'round-robin', 'unassigned')),
  round_robin_participant_ids uuid[] not null default '{}',
  round_robin_all_members boolean not null default false,
  round_robin_cursor int not null default 0,
  excluded_participant_ids uuid[] not null default '{}',
  due_date timestamptz not null,
  initial_due_date timestamptz,
  next_due_date timestamptz,
  scheduled_date date,
  initial_scheduled_date date,
  monthly_anchor_day int,
  excluded_occurrence_dates date[] not null default '{}',
  recurrence_ends_on date,
  completed boolean not null default false,
  completed_at timestamptz,
  completed_by_user_id uuid references auth.users(id) on delete set null,
  points int not null default 0,
  category text not null default 'other',
  recurring text check (recurring in ('daily', 'everyOtherDay', 'weekly', 'biweekly', 'monthly')),
  recurrence_series_id text,
  occurrence_index int,
  next_occurrence_id text,
  source_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The real constraint item #2 asked for: the database itself now refuses to
-- store two occurrences of the same recurring series on the same date,
-- directly on the chore data (recurring_chore_occurrence_keys already
-- enforced this for identity claims; this enforces it for the record itself).
create unique index if not exists chores_occurrence_unique
  on public.chores (household_id, recurrence_series_id, scheduled_date)
  where recurrence_series_id is not null;

create index if not exists chores_household_idx on public.chores (household_id);
create index if not exists chores_assigned_to_idx on public.chores (household_id, assigned_to);

alter table public.chores enable row level security;

drop policy if exists "members read chores" on public.chores;
create policy "members read chores" on public.chores for select
  to authenticated using (public.is_household_member(household_id));

drop policy if exists "members write chores" on public.chores;
create policy "members write chores" on public.chores for insert
  to authenticated with check (public.is_household_member(household_id));

drop policy if exists "members update chores" on public.chores;
create policy "members update chores" on public.chores for update
  to authenticated using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists "members delete chores" on public.chores;
create policy "members delete chores" on public.chores for delete
  to authenticated using (public.is_household_member(household_id));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chores'
  ) then
    alter publication supabase_realtime add table public.chores;
  end if;
end
$$;
