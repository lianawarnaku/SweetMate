begin;
do $$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); home uuid:=gen_random_uuid();
  event_id text; lease jsonb; payload jsonb; before_row jsonb; completed_time timestamptz; denied boolean;
begin
  event_id:='event-completion-'||a;
  insert into auth.users(id,email) values(a,a::text||'@event-test.invalid'),(b,b::text||'@event-test.invalid');
  insert into public.households(id,name,invite_code,created_by) values(home,'Event completion regression',home::text,a);
  insert into public.household_members(household_id,user_id,display_name,role,status)
    values(home,a,'Avery','owner','active'),(home,b,'Blake','member','active');
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.configure_personal_schedule(array['private-calendar'],array[]::text[],'America/New_York',true);
  perform public.set_schedule_busy_sharing(home,true);
  lease:=public.begin_personal_schedule_sync(a);
  payload:=jsonb_build_array(jsonb_build_object('id',event_id,'source','google-event','resource_id','private-calendar','provider_id','provider-event',
    'title','Private imported event','starts_at',now()-interval '10 minutes','ends_at',now()+interval '20 minutes','busy',true));
  perform public.finish_personal_schedule_sync(a,(lease->>'token')::uuid,now()-interval '1 day',now()+interval '1 day',payload);
  select to_jsonb(i)-'app_completed_at' into before_row from public.personal_schedule_items i where id=event_id;
  if not exists(select 1 from public.get_household_schedule_activity(home) where member_id=a) then raise exception 'An active unchecked event must share opted-in Busy status'; end if;

  perform public.update_personal_schedule_task(event_id,true);
  select app_completed_at into completed_time from public.personal_schedule_items where id=event_id;
  if completed_time is null then raise exception 'An event checkmark did not persist'; end if;
  if (select to_jsonb(i)-'app_completed_at' from public.personal_schedule_items i where id=event_id) is distinct from before_row then raise exception 'Checking an event changed its provider details or time'; end if;
  if exists(select 1 from public.get_household_schedule_activity(home) where member_id=a) then raise exception 'A checked event must stop sharing Busy'; end if;
  perform public.update_personal_schedule_task(event_id,true);
  if (select app_completed_at from public.personal_schedule_items where id=event_id)<>completed_time then raise exception 'A repeated completion must preserve the first check time'; end if;

  lease:=public.begin_personal_schedule_sync(a);
  perform public.finish_personal_schedule_sync(a,(lease->>'token')::uuid,now()-interval '1 day',now()+interval '1 day',payload);
  if (select app_completed_at from public.personal_schedule_items where id=event_id) is distinct from completed_time then raise exception 'Google synchronization reset the local event checkmark'; end if;
  perform public.update_personal_schedule_task(event_id,false);
  if (select app_completed_at from public.personal_schedule_items where id=event_id) is not null then raise exception 'Unchecking an event failed'; end if;
  if not exists(select 1 from public.get_household_schedule_activity(home) where member_id=a) then raise exception 'An active unchecked event must restore opted-in Busy status'; end if;

  denied:=false;
  begin perform public.update_personal_schedule_task(event_id,null,'night'); exception when others then
    if sqlerrm<>'Event times are managed in Google Calendar.' then raise; end if; denied:=true; end;
  if not denied then raise exception 'Events accepted task-only period overrides'; end if;
  denied:=false;
  begin perform public.update_personal_schedule_task(event_id,null,null,null,null,true); exception when others then
    if sqlerrm<>'Event times are managed in Google Calendar.' then raise; end if; denied:=true; end;
  if not denied then raise exception 'Events accepted task-only time clearing'; end if;

  perform set_config('request.jwt.claim.sub',b::text,true);
  denied:=false;
  begin perform public.update_personal_schedule_task(event_id,true); exception when others then
    if sqlerrm<>'This personal task is unavailable.' then raise; end if; denied:=true; end;
  if not denied then raise exception 'A roommate checked another person event'; end if;
  perform set_config('request.jwt.claim.sub','',true);
  denied:=false;
  begin perform public.update_personal_schedule_task(event_id,true); exception when others then
    if sqlerrm<>'Sign in to manage your tasks.' then raise; end if; denied:=true; end;
  if not denied or has_function_privilege('anon','public.update_personal_schedule_task(text,boolean,text,timestamptz,timestamptz,boolean)','execute')
    or has_table_privilege('authenticated','public.personal_schedule_items','update') then raise exception 'Event completion access restrictions were weakened'; end if;
end;
$$;
rollback;
select 'Event completion/undo, sync persistence, unchanged provider details, Busy status and owner authorization passed' as result;
