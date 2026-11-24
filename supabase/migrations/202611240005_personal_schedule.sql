begin;
create table public.personal_schedule_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  calendar_ids text[] not null default '{}',
  task_list_ids text[] not null default '{}',
  timezone text not null default 'UTC',
  synced_at timestamptz,
  attempted_at timestamptz,
  sync_error text,
  lease_id uuid,
  lease_until timestamptz
);
create table public.personal_schedule_items (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check(source in ('google-event','google-task')),
  resource_id text not null,
  provider_id text not null,
  title text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  starts_on date,
  ends_on date,
  busy boolean not null default false,
  link text,
  app_completed_at timestamptz,
  override_start timestamptz,
  override_end timestamptz,
  period_override text check(period_override in ('morning','night')),
  unique(user_id,source,resource_id,provider_id),
  check((starts_at is null and ends_at is null) or (starts_at is not null and ends_at is not null and ends_at > starts_at)),
  check((override_start is null and override_end is null) or (override_start is not null and override_end is not null and override_end > override_start))
);
create index personal_schedule_items_owner on public.personal_schedule_items(user_id);
create table public.member_schedule_sharing (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  primary key(household_id,user_id)
);
alter table public.personal_schedule_preferences enable row level security;
alter table public.personal_schedule_items enable row level security;
alter table public.member_schedule_sharing enable row level security;
create policy "owners read schedule preferences" on public.personal_schedule_preferences for select to authenticated using(user_id=auth.uid());
create policy "owners read schedule items" on public.personal_schedule_items for select to authenticated using(user_id=auth.uid());
create policy "owners read schedule sharing" on public.member_schedule_sharing for select to authenticated using(user_id=auth.uid() and public.is_household_member(household_id));
revoke all on public.personal_schedule_preferences,public.personal_schedule_items,public.member_schedule_sharing from public,anon,authenticated;
grant select on public.personal_schedule_preferences,public.personal_schedule_items,public.member_schedule_sharing to authenticated;

create function public.configure_personal_schedule(calendar_ids text[],task_list_ids text[],schedule_timezone text,enable_sync boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Sign in to manage your schedule.'; end if;
  if cardinality(calendar_ids)>10 or cardinality(task_list_ids)>10 or calendar_ids is null or task_list_ids is null
    then raise exception 'Choose up to 10 calendars and 10 task lists.'; end if;
  if exists(select 1 from unnest(calendar_ids || task_list_ids) id where id is null or length(id) not between 1 and 1024)
    then raise exception 'Invalid calendar or task list.'; end if;
  if not exists(select 1 from pg_timezone_names where name=schedule_timezone) then raise exception 'Choose a valid time zone.'; end if;
  insert into public.personal_schedule_preferences(user_id,enabled,calendar_ids,task_list_ids,timezone)
    values(auth.uid(),enable_sync,calendar_ids,task_list_ids,schedule_timezone)
    on conflict(user_id) do update set enabled=excluded.enabled,calendar_ids=excluded.calendar_ids,
      task_list_ids=excluded.task_list_ids,timezone=excluded.timezone,lease_id=null,lease_until=null,synced_at=null,sync_error=null;
  if not enable_sync then delete from public.personal_schedule_items where user_id=auth.uid(); end if;
end;
$$;
create function public.set_schedule_busy_sharing(target_household_id uuid,share_busy boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not public.is_household_member(target_household_id) then raise exception 'Active household membership required'; end if;
  insert into public.member_schedule_sharing values(target_household_id,auth.uid(),share_busy)
    on conflict(household_id,user_id) do update set enabled=excluded.enabled;
end;
$$;
create function public.update_personal_schedule_task(task_id text,completed boolean default null,task_period text default null,time_start timestamptz default null,time_end timestamptz default null,clear_time boolean default false)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Sign in to manage your tasks.'; end if;
  if task_period is not null and task_period not in ('morning','night') then raise exception 'Choose Morning or Night.'; end if;
  if (time_start is null)<>(time_end is null) or time_end<=time_start or time_end-time_start>interval '24 hours' then raise exception 'Choose an end time after the start, within 24 hours.'; end if;
  update public.personal_schedule_items set
    app_completed_at=case when completed is null then app_completed_at when completed then clock_timestamp() else null end,
    period_override=coalesce(task_period,period_override),
    override_start=case when clear_time then null else coalesce(time_start,override_start) end,
    override_end=case when clear_time then null else coalesce(time_end,override_end) end
    where id=task_id and user_id=auth.uid() and source='google-task';
  if not found then raise exception 'This personal task is unavailable.'; end if;
end;
$$;

-- Roommates receive only current busy intervals, never imported titles,
-- locations, notes, calendar IDs, or a copy of someone else's schedule.
create function public.get_household_schedule_activity(target_household_id uuid)
returns table(member_id uuid,ends_at timestamptz) language plpgsql stable security definer set search_path=public as $$
begin
  if auth.uid() is null or not public.is_household_member(target_household_id) then raise exception 'Active household membership required'; end if;
  return query select i.user_id,max(coalesce(i.override_end,i.ends_at))
    from public.personal_schedule_items i
    join public.member_schedule_sharing s on s.user_id=i.user_id and s.household_id=target_household_id and s.enabled
    join public.household_members m on m.user_id=i.user_id and m.household_id=target_household_id and m.status='active'
    join public.personal_schedule_preferences p on p.user_id=i.user_id and p.enabled and p.synced_at>now()-interval '15 minutes'
    where i.app_completed_at is null and (i.busy or i.override_start is not null)
      and coalesce(i.override_start,i.starts_at)<=now() and coalesce(i.override_end,i.ends_at)>now()
      and ((i.source='google-event' and i.resource_id=any(p.calendar_ids)) or (i.source='google-task' and i.resource_id=any(p.task_list_ids)))
    group by i.user_id;
end;
$$;

-- Service-only leased snapshots prevent a slow Google response from restoring
-- calendars that the user deselected or disconnected during a sync.
create function public.begin_personal_schedule_sync(owner_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare prefs public.personal_schedule_preferences%rowtype; token uuid:=gen_random_uuid();
begin
  select * into prefs from public.personal_schedule_preferences where user_id=owner_id for update;
  if not found or not prefs.enabled or prefs.lease_until>clock_timestamp() then return null; end if;
  update public.personal_schedule_preferences set lease_id=token,lease_until=clock_timestamp()+interval '3 minutes',attempted_at=clock_timestamp() where user_id=owner_id;
  return jsonb_build_object('token',token,'calendarIds',prefs.calendar_ids,'taskListIds',prefs.task_list_ids,'timezone',prefs.timezone);
end;
$$;
create function public.finish_personal_schedule_sync(owner_id uuid,sync_token uuid,window_start timestamptz,window_end timestamptz,items jsonb,error_code text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare prefs public.personal_schedule_preferences%rowtype;
begin
  select * into prefs from public.personal_schedule_preferences where user_id=owner_id for update;
  if not found or not prefs.enabled or sync_token is null or prefs.lease_id is distinct from sync_token then return false; end if;
  if error_code is not null then
    update public.personal_schedule_preferences set lease_id=null,lease_until=null,sync_error=left(error_code,80) where user_id=owner_id;
    return false;
  end if;
  if jsonb_typeof(items)<>'array' or jsonb_array_length(items)>10000 or window_end<=window_start or window_end-window_start>interval '93 days'
    then raise exception 'Invalid schedule snapshot.'; end if;
  insert into public.personal_schedule_items(id,user_id,source,resource_id,provider_id,title,starts_at,ends_at,starts_on,ends_on,busy,link)
    select r.id,owner_id,r.source,r.resource_id,r.provider_id,r.title,r.starts_at,r.ends_at,r.starts_on,r.ends_on,r.busy,r.link
    from jsonb_to_recordset(items) as r(id text,source text,resource_id text,provider_id text,title text,starts_at timestamptz,ends_at timestamptz,starts_on date,ends_on date,busy boolean,link text)
    where (r.source='google-event' and r.resource_id=any(prefs.calendar_ids)) or (r.source='google-task' and r.resource_id=any(prefs.task_list_ids))
    on conflict(id) do update set title=excluded.title,starts_at=excluded.starts_at,ends_at=excluded.ends_at,
      starts_on=excluded.starts_on,ends_on=excluded.ends_on,busy=excluded.busy,link=excluded.link
      where personal_schedule_items.user_id=owner_id;
  delete from public.personal_schedule_items i where i.user_id=owner_id and (
    (i.source='google-event' and (not(i.resource_id=any(prefs.calendar_ids)) or
      (coalesce(i.ends_at,(i.ends_on::timestamp at time zone prefs.timezone))>window_start and coalesce(i.starts_at,(i.starts_on::timestamp at time zone prefs.timezone))<window_end)))
    or i.source='google-task') and not exists(select 1 from jsonb_array_elements(items) entry where entry->>'id'=i.id);
  update public.personal_schedule_preferences set synced_at=clock_timestamp(),sync_error=null,lease_id=null,lease_until=null where user_id=owner_id;
  return true;
end;
$$;
revoke all on function public.configure_personal_schedule(text[],text[],text,boolean),public.set_schedule_busy_sharing(uuid,boolean),public.update_personal_schedule_task(text,boolean,text,timestamptz,timestamptz,boolean),public.get_household_schedule_activity(uuid) from public,anon;
grant execute on function public.configure_personal_schedule(text[],text[],text,boolean),public.set_schedule_busy_sharing(uuid,boolean),public.update_personal_schedule_task(text,boolean,text,timestamptz,timestamptz,boolean),public.get_household_schedule_activity(uuid) to authenticated;
revoke all on function public.begin_personal_schedule_sync(uuid),public.finish_personal_schedule_sync(uuid,uuid,timestamptz,timestamptz,jsonb,text) from public,anon,authenticated;
grant execute on function public.begin_personal_schedule_sync(uuid),public.finish_personal_schedule_sync(uuid,uuid,timestamptz,timestamptz,jsonb,text) to service_role;
grant select,insert,update,delete on public.personal_schedule_preferences,public.personal_schedule_items,public.member_schedule_sharing to service_role;
grant select,insert,update,delete on public.google_calendar_connections to service_role;

create function public.clear_disconnected_personal_schedule()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.personal_schedule_preferences set enabled=false,lease_id=null,lease_until=null,synced_at=null where user_id=old.user_id;
  delete from public.personal_schedule_items where user_id=old.user_id;
  update public.member_schedule_sharing set enabled=false where user_id=old.user_id;
  return old;
end;
$$;
revoke all on function public.clear_disconnected_personal_schedule() from public,anon,authenticated;
create trigger clear_disconnected_personal_schedule after delete on public.google_calendar_connections for each row execute function public.clear_disconnected_personal_schedule();

create function public.dispatch_personal_schedule_sync()
returns void language plpgsql security definer set search_path='' as $$
declare project_url text; worker_token text;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name='calendar_sync_project_url';
  select decrypted_secret into worker_token from vault.decrypted_secrets where name='calendar_sync_worker_token';
  if project_url is null or worker_token is null then return; end if;
  if not exists(select 1 from public.personal_schedule_preferences where enabled and (synced_at is null or synced_at<now()-interval '5 minutes') and (lease_until is null or lease_until<now())) then return; end if;
  perform net.http_post(url:=project_url||'/functions/v1/google-schedule/worker',headers:=jsonb_build_object('Authorization','Bearer '||worker_token,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=120000);
end;
$$;
revoke all on function public.dispatch_personal_schedule_sync() from public,anon,authenticated;
select cron.schedule('personal-schedule-sync','*/5 * * * *','select public.dispatch_personal_schedule_sync()');
notify pgrst,'reload schema';
commit;
