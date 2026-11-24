begin;
do $$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); home uuid:=gen_random_uuid();
  lease jsonb; old_lease jsonb; payload jsonb; denied boolean; activity jsonb; saved_time timestamptz;
begin
  insert into auth.users(id,email) values(a,a::text||'@schedule-test.invalid'),(b,b::text||'@schedule-test.invalid'),(outsider,outsider::text||'@schedule-test.invalid');
  insert into public.households(id,name,invite_code,created_by) values(home,'Schedule regression',home::text,a);
  insert into public.household_members(household_id,user_id,display_name,role,status) values(home,a,'Avery','owner','active'),(home,b,'Blake','member','active');
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.configure_personal_schedule(array['private-calendar'],array['private-tasks'],'America/New_York',true);
  insert into public.google_calendar_connections(user_id,refresh_token) values(a,'regression-placeholder');
  lease:=public.begin_personal_schedule_sync(a);
  if lease is null or public.begin_personal_schedule_sync(a) is not null then raise exception 'Concurrent sync must be leased once per owner'; end if;
  payload:=jsonb_build_array(
    jsonb_build_object('id','secret-event-'||a,'source','google-event','resource_id','private-calendar','provider_id','event','title','PRIVATE APPOINTMENT TITLE',
      'starts_at',now()-interval '10 minutes','ends_at',now()+interval '20 minutes','busy',true),
    jsonb_build_object('id','secret-task-'||a,'source','google-task','resource_id','private-tasks','provider_id','task','title','PRIVATE TASK TITLE','starts_on',current_date,'busy',false),
    jsonb_build_object('id','all-day-'||a,'source','google-event','resource_id','private-calendar','provider_id','all-day','title','PRIVATE ALL DAY',
      'starts_on',current_date,'ends_on',current_date+1,'busy',false));
  if not public.finish_personal_schedule_sync(a,(lease->>'token')::uuid,now()-interval '1 day',now()+interval '2 days',payload) then raise exception 'A valid full snapshot did not apply'; end if;
  if (select count(*) from public.personal_schedule_items where user_id=a)<>3 then raise exception 'The private snapshot lost imported items'; end if;
  perform set_config('request.jwt.claim.sub',b::text,true);
  perform set_config('role','authenticated',true);
  if exists(select 1 from public.personal_schedule_items where user_id=a)
    or exists(select 1 from public.personal_schedule_preferences where user_id=a)

  then raise exception 'Private schedule or Google credentials leaked to a roommate'; end if;
  begin
    if exists(select 1 from public.google_calendar_connections where user_id=a) then raise exception 'Google credentials leaked to a roommate'; end if;
  exception when insufficient_privilege then null; end;
  perform set_config('role','postgres',true);
  if exists(select 1 from public.get_household_schedule_activity(home)) then raise exception 'Old Show Roommate Activity preferences must not opt a sender into sharing'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.set_schedule_busy_sharing(home,true);
  perform set_config('request.jwt.claim.sub',b::text,true);
  select jsonb_agg(to_jsonb(x)) into activity from public.get_household_schedule_activity(home) x;
  if jsonb_array_length(activity)<>1 or activity->0->>'member_id'<>a::text or activity->0->>'ends_at' is null
    or (activity->0)-'member_id'-'ends_at'<>'{}'::jsonb or activity::text like '%PRIVATE%'
  then raise exception 'Roommate activity must contain only the opted-in member and busy end time'; end if;
  denied:=false;
  begin perform public.update_personal_schedule_task('secret-task-'||a,true); exception when others then
    if sqlerrm<>'This personal task is unavailable.' then raise; end if; denied:=true; end;
  if not denied then raise exception 'A roommate changed another user task'; end if;

  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.update_personal_schedule_task('secret-task-'||a,true,'night',now()-interval '5 minutes',now()+interval '50 minutes');
  select override_start into saved_time from public.personal_schedule_items where id='secret-task-'||a;
  lease:=public.begin_personal_schedule_sync(a);
  perform public.finish_personal_schedule_sync(a,(lease->>'token')::uuid,now()-interval '1 day',now()+interval '2 days',payload);
  if not exists(select 1 from public.personal_schedule_items where id='secret-task-'||a and app_completed_at is not null and override_start=saved_time and period_override='night')
  then raise exception 'Sync overwrote SweetMate task completion or its local time'; end if;
  perform public.update_personal_schedule_task('secret-task-'||a,false);
  perform set_config('request.jwt.claim.sub',b::text,true);
  if (select ends_at from public.get_household_schedule_activity(home) where member_id=a)<>now()+interval '50 minutes'
  then raise exception 'An explicitly timed personal task must contribute its current Busy interval'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.set_schedule_busy_sharing(home,false);
  if exists(select 1 from public.get_household_schedule_activity(home)) then raise exception 'Turning sharing off must withdraw Busy immediately'; end if;
  perform public.set_schedule_busy_sharing(home,true);
  update public.personal_schedule_preferences set synced_at=now()-interval '16 minutes' where user_id=a;
  if exists(select 1 from public.get_household_schedule_activity(home)) then raise exception 'Stale schedule data must not assert current activity'; end if;
  update public.personal_schedule_preferences set synced_at=now() where user_id=a;
  update public.household_members set status='left' where household_id=home and user_id=a;
  perform set_config('request.jwt.claim.sub',b::text,true);
  if exists(select 1 from public.get_household_schedule_activity(home)) then raise exception 'A departed member still appeared as Busy'; end if;
  update public.household_members set status='active' where household_id=home and user_id=a;

  perform set_config('request.jwt.claim.sub',a::text,true);
  old_lease:=public.begin_personal_schedule_sync(a);
  perform public.configure_personal_schedule(array['new-calendar'],array[]::text[],'America/New_York',true);
  if public.finish_personal_schedule_sync(a,(old_lease->>'token')::uuid,now()-interval '1 day',now()+interval '2 days',payload)
  then raise exception 'An old Google response restored deselected calendars'; end if;
  if exists(select 1 from public.get_household_schedule_activity(home)) then raise exception 'A deselected calendar still shared Busy activity'; end if;
  perform public.configure_personal_schedule(array['private-calendar'],array['private-tasks'],'America/New_York',true);
  lease:=public.begin_personal_schedule_sync(a);
  perform public.finish_personal_schedule_sync(a,(lease->>'token')::uuid,now()-interval '1 day',now()+interval '2 days','[]'::jsonb,'GOOGLE_SCHEDULE_UNAVAILABLE');
  if (select count(*) from public.personal_schedule_items where user_id=a)<>3 then raise exception 'A failed Google request erased the cached schedule'; end if;
  lease:=public.begin_personal_schedule_sync(a);
  perform public.finish_personal_schedule_sync(a,(lease->>'token')::uuid,now()-interval '1 day',now()+interval '2 days','[]'::jsonb);
  if exists(select 1 from public.personal_schedule_items where user_id=a) then raise exception 'Provider deletions did not remove stale imported entries'; end if;
  lease:=public.begin_personal_schedule_sync(a);
  perform public.finish_personal_schedule_sync(a,(lease->>'token')::uuid,now()-interval '1 day',now()+interval '2 days',payload);
  delete from public.google_calendar_connections where user_id=a;
  if exists(select 1 from public.personal_schedule_items where user_id=a)
    or exists(select 1 from public.personal_schedule_preferences where user_id=a and enabled)
    or exists(select 1 from public.member_schedule_sharing where user_id=a and enabled)
  then raise exception 'Disconnecting Google must clear imports, stop syncing, and withdraw Busy sharing'; end if;
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  denied:=false;
  begin perform public.get_household_schedule_activity(home); exception when others then
    if sqlerrm<>'Active household membership required' then raise; end if; denied:=true; end;
  if not denied then raise exception 'An outsider could query household schedule activity'; end if;
  if has_function_privilege('authenticated','public.begin_personal_schedule_sync(uuid)','execute')
    or has_function_privilege('authenticated','public.finish_personal_schedule_sync(uuid,uuid,timestamptz,timestamptz,jsonb,text)','execute')
    or has_table_privilege('authenticated','public.personal_schedule_items','insert')
    or has_table_privilege('authenticated','public.personal_schedule_items','update')
    or has_function_privilege('anon','public.get_household_schedule_activity(uuid)','execute')
  then raise exception 'Private schedule mutation permissions can be bypassed'; end if;
end;
$$;
rollback;
select 'Personal schedule ownership, Busy-only consent/expiry, sync leases, task overrides, and disconnect tests passed' as result;
