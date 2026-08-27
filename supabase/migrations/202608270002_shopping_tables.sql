-- phase4-migration.sql may have installed incompatible UUID-based tables.
-- Production was audited at zero rows in both. Keep the guard so another
-- environment with real legacy data stops instead of losing it.
do $$
declare list_rows bigint;
declare item_rows bigint;
begin
  if to_regclass('public.shopping_lists') is not null and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'shopping_lists' and column_name = 'entry'
  ) then
    execute 'select count(*) from public.shopping_lists' into list_rows;
    if to_regclass('public.shopping_items') is not null then
      execute 'select count(*) from public.shopping_items' into item_rows;
    else
      item_rows := 0;
    end if;
    if list_rows > 0 or item_rows > 0 then
      raise exception 'refusing to replace legacy shopping tables: % lists, % items exist', list_rows, item_rows;
    end if;
    drop table if exists public.shopping_items;
    drop table public.shopping_lists;
  end if;
end $$;

create table public.shopping_lists (
  id text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  assigned_to uuid references auth.users(id) on delete set null,
  pinned boolean not null default false,
  planned_date date,
  sort_order integer not null check (sort_order >= 0),
  entry jsonb not null check (jsonb_typeof(entry) = 'object'),
  updated_at timestamptz not null default now(),
  unique (household_id, id)
);
create table public.shopping_items (
  id text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  list_id text not null references public.shopping_lists(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  completed boolean not null default false,
  sort_order integer not null check (sort_order >= 0),
  entry jsonb not null check (jsonb_typeof(entry) = 'object'),
  updated_at timestamptz not null default now(),
  unique (household_id, id),
  foreign key (household_id, list_id) references public.shopping_lists(household_id, id) on delete cascade
);
create index shopping_lists_order_idx on public.shopping_lists (household_id, pinned desc, sort_order);
create index shopping_items_order_idx on public.shopping_items (household_id, list_id, sort_order);
create or replace function public.set_normalized_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger shopping_lists_updated_at before update on public.shopping_lists for each row execute function public.set_normalized_updated_at();
create trigger shopping_items_updated_at before update on public.shopping_items for each row execute function public.set_normalized_updated_at();
alter table public.shopping_lists enable row level security;
alter table public.shopping_items enable row level security;
create policy "members manage shopping lists" on public.shopping_lists for all to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "members manage shopping items" on public.shopping_items for all to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='shopping_lists') then alter publication supabase_realtime add table public.shopping_lists; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='shopping_items') then alter publication supabase_realtime add table public.shopping_items; end if;
end $$;
