begin;

-- Preserve the existing RPC signature for installed clients. Both imported
-- kinds support SweetMate completion; only Tasks support local time overrides.
create or replace function public.update_personal_schedule_task(
  task_id text, completed boolean default null, task_period text default null,
  time_start timestamptz default null, time_end timestamptz default null,
  clear_time boolean default false
)
returns void language plpgsql security definer set search_path=public as $$
declare item_source text;
begin
  if auth.uid() is null then raise exception 'Sign in to manage your tasks.'; end if;
  if task_period is not null and task_period not in ('morning','night') then raise exception 'Choose Morning or Night.'; end if;
  if (time_start is null)<>(time_end is null) or time_end<=time_start or time_end-time_start>interval '24 hours'
    then raise exception 'Choose an end time after the start, within 24 hours.'; end if;

  select source into item_source from public.personal_schedule_items
    where id=task_id and user_id=auth.uid() for update;
  if not found then raise exception 'This personal task is unavailable.'; end if;
  if item_source='google-event' and (task_period is not null or time_start is not null or time_end is not null or coalesce(clear_time,false))
    then raise exception 'Event times are managed in Google Calendar.'; end if;

  update public.personal_schedule_items set
    app_completed_at=case when completed is null then app_completed_at when completed then coalesce(app_completed_at,clock_timestamp()) else null end,
    period_override=coalesce(task_period,period_override),
    override_start=case when clear_time then null else coalesce(time_start,override_start) end,
    override_end=case when clear_time then null else coalesce(time_end,override_end) end
    where id=task_id and user_id=auth.uid();
end;
$$;
revoke all on function public.update_personal_schedule_task(text,boolean,text,timestamptz,timestamptz,boolean) from public,anon;
grant execute on function public.update_personal_schedule_task(text,boolean,text,timestamptz,timestamptz,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
