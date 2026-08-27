create table public.shared_borrow_items (
  id text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  creator_id uuid references auth.users(id) on delete set null,
  owner_id uuid references auth.users(id) on delete set null,
  borrowed_from uuid not null references auth.users(id) on delete restrict,
  borrowed_by uuid references auth.users(id) on delete set null,
  due_date timestamptz not null,
  returned boolean not null default false,
  entry jsonb not null check (jsonb_typeof(entry) = 'object' and entry->>'visibility' = 'shared'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shared_borrow_household_due_idx on public.shared_borrow_items (household_id, returned, due_date);
alter table public.shared_borrow_items enable row level security;
create policy "members manage shared borrow items" on public.shared_borrow_items for all to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='shared_borrow_items') then alter publication supabase_realtime add table public.shared_borrow_items; end if;
end $$;
