begin;

-- OAuth and the private imported-item cache remain personal. Selecting those
-- sources for My Sweet is a separate, private opt-in in each household.
create table public.member_schedule_preferences (
  household_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  calendar_ids text[] not null default '{}',
  task_list_ids text[] not null default '{}',
  timezone text not null default 'UTC',
  primary key (household_id,user_id),
  foreign key (household_id,user_id) references public.household_members(household_id,user_id) on delete cascade
);
alter table public.member_schedule_preferences enable row level security;
create policy "owners read household schedule setup" on public.member_schedule_preferences
  for select to authenticated using (user_id=auth.uid() and public.is_household_member(household_id));
revoke all on public.member_schedule_preferences from public,anon,authenticated;
grant select on public.member_schedule_preferences to authenticated;
grant all on public.member_schedule_preferences to service_role;

-- Preserve homes explicitly configured in the old picker, even with sharing
-- turned off. If no sharing row exists, preserve only the original membership;
-- never copy a personal connection to every household or to future households.
insert into public.member_schedule_preferences(household_id,user_id,enabled,calendar_ids,task_list_ids,timezone)
select m.household_id,p.user_id,p.enabled,p.calendar_ids,p.task_list_ids,p.timezone
from public.personal_schedule_preferences p
join public.household_members m on m.user_id=p.user_id and m.status='active'
where exists(select 1 from public.member_schedule_sharing s where s.user_id=p.user_id and s.household_id=m.household_id)
  or (not exists(select 1 from public.member_schedule_sharing s join public.household_members sm
      on sm.household_id=s.household_id and sm.user_id=s.user_id and sm.status='active' where s.user_id=p.user_id)
    and m.household_id=(select first_home.household_id from public.household_members first_home
      where first_home.user_id=p.user_id and first_home.status='active' order by first_home.joined_at,first_home.household_id limit 1));

-- The existing worker imports the union so changing/pausing one household
-- cannot discard another household's selected sources or imported items.
create function public.refresh_household_schedule_sources(owner_id uuid,preferred_timezone text)
returns void language plpgsql security definer set search_path=public as $$
declare calendars text[]; tasks text[]; any_enabled boolean;
begin
  select coalesce(array_agg(distinct source order by source),'{}') into calendars
    from public.member_schedule_preferences p join public.household_members m using(household_id,user_id)
    cross join lateral unnest(p.calendar_ids) source where p.user_id=owner_id and p.enabled and m.status='active';
  select coalesce(array_agg(distinct source order by source),'{}') into tasks
    from public.member_schedule_preferences p join public.household_members m using(household_id,user_id)
    cross join lateral unnest(p.task_list_ids) source where p.user_id=owner_id and p.enabled and m.status='active';
  select exists(select 1 from public.member_schedule_preferences p join public.household_members m using(household_id,user_id)
    where p.user_id=owner_id and p.enabled and m.status='active') into any_enabled;
  if cardinality(calendars)>10 or cardinality(tasks)>10 then raise exception 'Choose up to 10 different calendars and 10 task lists across your households.'; end if;
  update public.personal_schedule_preferences p set
    enabled=any_enabled,calendar_ids=calendars,task_list_ids=tasks,timezone=preferred_timezone,
    synced_at=case when p.calendar_ids is distinct from calendars or p.task_list_ids is distinct from tasks or p.enabled is distinct from any_enabled then null else p.synced_at end,
    lease_id=null,lease_until=null,sync_error=null where p.user_id=owner_id;
  delete from public.personal_schedule_items i where i.user_id=owner_id and
    ((i.source='google-event' and not(i.resource_id=any(calendars))) or (i.source='google-task' and not(i.resource_id=any(tasks))));
end;
$$;
revoke all on function public.refresh_household_schedule_sources(uuid,text) from public,anon,authenticated;
grant execute on function public.refresh_household_schedule_sources(uuid,text) to service_role;

create function public.configure_household_schedule(target_household_id uuid,calendar_ids text[],task_list_ids text[],schedule_timezone text,enable_sync boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not public.is_household_member(target_household_id) then raise exception 'Active household membership required'; end if;
  if calendar_ids is null or task_list_ids is null or enable_sync is null or cardinality(calendar_ids)>10 or cardinality(task_list_ids)>10
    then raise exception 'Choose up to 10 calendars and 10 task lists.'; end if;
  if enable_sync and cardinality(calendar_ids)+cardinality(task_list_ids)=0 then raise exception 'Choose at least one calendar or task list.'; end if;
  if exists(select 1 from unnest(calendar_ids || task_list_ids) id where id is null or length(id) not between 1 and 1024) then raise exception 'Invalid calendar or task list.'; end if;
  if not exists(select 1 from pg_timezone_names where name=schedule_timezone) then raise exception 'Choose a valid time zone.'; end if;
  insert into public.personal_schedule_preferences(user_id) values(auth.uid()) on conflict(user_id) do nothing;
  -- Serialize changes from different devices/households for this person.
  perform 1 from public.personal_schedule_preferences where user_id=auth.uid() for update;
  insert into public.member_schedule_preferences(household_id,user_id,enabled,calendar_ids,task_list_ids,timezone)
    values(target_household_id,auth.uid(),enable_sync,case when enable_sync then calendar_ids else '{}' end,case when enable_sync then task_list_ids else '{}' end,schedule_timezone)
    on conflict(household_id,user_id) do update set enabled=excluded.enabled,calendar_ids=excluded.calendar_ids,task_list_ids=excluded.task_list_ids,timezone=excluded.timezone;
  if not enable_sync then update public.member_schedule_sharing set enabled=false where household_id=target_household_id and user_id=auth.uid(); end if;
  perform public.refresh_household_schedule_sources(auth.uid(),schedule_timezone);
end;
$$;
revoke all on function public.configure_household_schedule(uuid,text[],text[],text,boolean) from public,anon;
grant execute on function public.configure_household_schedule(uuid,text[],text[],text,boolean) to authenticated;

-- An older installed client can explicitly enable sharing after configuring
-- its personal sources. Preserve that flow without automatically opting in a
-- new household simply because it exists.
create or replace function public.set_schedule_busy_sharing(target_household_id uuid,share_busy boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not public.is_household_member(target_household_id) then raise exception 'Active household membership required'; end if;
  if share_busy then
    insert into public.member_schedule_preferences(household_id,user_id,enabled,calendar_ids,task_list_ids,timezone)
      select target_household_id,p.user_id,p.enabled,p.calendar_ids,p.task_list_ids,p.timezone from public.personal_schedule_preferences p where p.user_id=auth.uid()
      on conflict(household_id,user_id) do nothing;
  end if;
  insert into public.member_schedule_sharing values(target_household_id,auth.uid(),share_busy)
    on conflict(household_id,user_id) do update set enabled=excluded.enabled;
end;
$$;

create or replace function public.get_household_schedule_activity(target_household_id uuid)
returns table(member_id uuid,ends_at timestamptz) language plpgsql stable security definer set search_path=public as $$
begin
  if auth.uid() is null or not public.is_household_member(target_household_id) then raise exception 'Active household membership required'; end if;
  return query select i.user_id,max(coalesce(i.override_end,i.ends_at))
    from public.personal_schedule_items i
    join public.member_schedule_sharing s on s.user_id=i.user_id and s.household_id=target_household_id and s.enabled
    join public.member_schedule_preferences p on p.user_id=i.user_id and p.household_id=target_household_id and p.enabled
    join public.household_members m on m.user_id=i.user_id and m.household_id=target_household_id and m.status='active'
    join public.personal_schedule_preferences sync on sync.user_id=i.user_id and sync.enabled and sync.synced_at>now()-interval '15 minutes'
    where i.app_completed_at is null and (i.busy or i.override_start is not null)
      and coalesce(i.override_start,i.starts_at)<=now() and coalesce(i.override_end,i.ends_at)>now()
      and ((i.source='google-event' and i.resource_id=any(p.calendar_ids)) or (i.source='google-task' and i.resource_id=any(p.task_list_ids)))
    group by i.user_id;
end;
$$;

create or replace function public.clear_disconnected_personal_schedule()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.personal_schedule_preferences set enabled=false,lease_id=null,lease_until=null,synced_at=null where user_id=old.user_id;
  update public.member_schedule_preferences set enabled=false where user_id=old.user_id;
  delete from public.personal_schedule_items where user_id=old.user_id;
  update public.member_schedule_sharing set enabled=false where user_id=old.user_id;
  return old;
end;
$$;
notify pgrst,'reload schema';
commit;
