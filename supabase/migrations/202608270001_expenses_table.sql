create table if not exists public.expenses (
  id text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  paid_by uuid not null references auth.users(id) on delete restrict,
  creator_id uuid references auth.users(id) on delete set null,
  amount_cents bigint not null check (amount_cents >= 0),
  expense_date date not null,
  settled boolean not null default false,
  entry jsonb not null check (jsonb_typeof(entry) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expenses_household_date_idx on public.expenses (household_id, expense_date desc);
alter table public.expenses enable row level security;
create policy "members read expenses" on public.expenses for select to authenticated using (public.is_household_member(household_id));
create policy "members insert expenses" on public.expenses for insert to authenticated with check (public.is_household_member(household_id));
create policy "members update expenses" on public.expenses for update to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "members delete expenses" on public.expenses for delete to authenticated using (public.is_household_member(household_id));
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'expenses') then
    alter publication supabase_realtime add table public.expenses;
  end if;
end $$;
