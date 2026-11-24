begin;
create or replace function public.get_household_chart_review(target_household_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare latest_chart public.proposed_charts%rowtype; votes jsonb;
begin
  if auth.uid() is null or not public.is_household_member(target_household_id)
  then raise exception 'Active household membership required'; end if;
  select * into latest_chart from public.proposed_charts
    where household_id = target_household_id and status in ('pending', 'approved')
    order by created_at desc, id desc limit 1;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.member_id), '[]'::jsonb) into votes
    from public.proposed_chart_approvals a where a.proposed_chart_id = latest_chart.id;
  return jsonb_build_object('householdId', target_household_id,
    'chart', case when latest_chart.id is null then null else to_jsonb(latest_chart) end,
    'approvals', votes);
end;
$$;
revoke all on function public.get_household_chart_review(uuid) from public, anon;
grant execute on function public.get_household_chart_review(uuid) to authenticated;

create table if not exists public.chore_chart_restart_notifications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  chart_id uuid not null references public.proposed_charts(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text not null,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  unique(chart_id, recipient_id)
);
alter table public.chore_chart_restart_notifications enable row level security;
create policy "recipients read chart restart alerts" on public.chore_chart_restart_notifications
  for select to authenticated using (recipient_id = auth.uid() and public.is_household_member(household_id));
create policy "recipients mark chart restart alerts read" on public.chore_chart_restart_notifications
  for update to authenticated using (recipient_id = auth.uid() and public.is_household_member(household_id))
  with check (recipient_id = auth.uid() and public.is_household_member(household_id));
revoke all on public.chore_chart_restart_notifications from public, anon, authenticated;
grant select, update(read_at) on public.chore_chart_restart_notifications to authenticated;
create index chore_chart_restart_notifications_recipient on public.chore_chart_restart_notifications(household_id, recipient_id, created_at desc);
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chore_chart_restart_notifications')
  then alter publication supabase_realtime add table public.chore_chart_restart_notifications; end if;
end $$;

create or replace function public.restart_chore_chart_review(target_household_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  previous_chart public.proposed_charts%rowtype;
  new_chart_id uuid;
  restarting_name text;
begin
  if auth.uid() is null or not public.is_household_member(target_household_id)
  then raise exception 'Active household membership required'; end if;
  perform 1 from public.households where id = target_household_id for update;
  if not public.is_household_member(target_household_id)
  then raise exception 'Active household membership required'; end if;

  select * into previous_chart from public.proposed_charts
    where household_id = target_household_id and status in ('pending', 'approved')
    order by created_at desc, id desc limit 1;
  if not found then return null; end if;

  update public.proposed_charts set status = 'cancelled'
    where household_id = target_household_id and status = 'pending';
  -- Keep the saved rules as an editable draft, including older plans that
  -- need a rebuild for the current roster. Approval still validates the entire
  -- payload; merely restarting must not apply chores or erase saved settings.
  insert into public.proposed_charts(household_id, created_by, status, payload, created_at)
    values (target_household_id, auth.uid(), 'pending', previous_chart.payload, clock_timestamp())
    returning id into new_chart_id;
  insert into public.proposed_chart_approvals(household_id, proposed_chart_id, member_id, approved)
    select target_household_id, new_chart_id, user_id, false
    from public.household_members
    where household_id = target_household_id and status = 'active';
  select display_name into restarting_name from public.household_members
    where household_id = target_household_id and user_id = auth.uid() and status = 'active';
  insert into public.chore_chart_restart_notifications(household_id, chart_id, actor_id, actor_name, recipient_id)
    select target_household_id, new_chart_id, auth.uid(), coalesce(restarting_name, 'A Sweetmate'), user_id
    from public.household_members
    where household_id = target_household_id and status = 'active' and user_id <> auth.uid();
  return new_chart_id;
end;
$$;
revoke all on function public.restart_chore_chart_review(uuid) from public, anon;
grant execute on function public.restart_chore_chart_review(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
