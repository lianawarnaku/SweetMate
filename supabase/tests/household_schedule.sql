begin;
do $$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  home_a uuid:=gen_random_uuid(); home_b uuid:=gen_random_uuid(); other_home uuid:=gen_random_uuid(); fresh_home uuid:=gen_random_uuid();
  old_lease jsonb; denied boolean; activity_end timestamptz;
begin
  insert into auth.users(id,email) values(a,a::text||'@household-schedule.invalid'),(b,b::text||'@household-schedule.invalid'),(outsider,outsider::text||'@household-schedule.invalid');
  insert into public.households(id,name,invite_code,created_by) values(home_a,'Original schedule home',home_a::text,a),(home_b,'Second schedule home',home_b::text,a),(other_home,'Other home',other_home::text,outsider);
  insert into public.household_members(household_id,user_id,display_name,role,status) values(home_a,a,'Avery','owner','active'),(home_a,b,'Blake','member','active'),(home_b,a,'Avery','owner','active'),(home_b,b,'Blake','member','active'),(other_home,outsider,'Other','owner','active');
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.configure_household_schedule(home_a,array['calendar-a'],array['tasks-a'],'America/New_York',true);
  if exists(select 1 from public.member_schedule_preferences where user_id=a and household_id=home_b) then raise exception 'A new household inherited another home''s setup'; end if;
  insert into public.personal_schedule_items(id,user_id,source,resource_id,provider_id,title,starts_at,ends_at,busy) values
    ('event-a-'||a,a,'google-event','calendar-a','event-a','PRIVATE A',now()-interval '5 minutes',now()+interval '60 minutes',true);
  old_lease:=public.begin_personal_schedule_sync(a);
  perform public.configure_household_schedule(home_b,array['calendar-b'],array['tasks-b'],'America/Los_Angeles',true);
  if (select calendar_ids from public.member_schedule_preferences where user_id=a and household_id=home_a)<>array['calendar-a']
    or (select timezone from public.member_schedule_preferences where user_id=a and household_id=home_a)<>'America/New_York'
    then raise exception 'Configuring B changed A''s selections or timezone'; end if;
  if (select calendar_ids from public.personal_schedule_preferences where user_id=a)<>array['calendar-a','calendar-b'] then raise exception 'Background sync did not retain both homes'' sources'; end if;
  if public.finish_personal_schedule_sync(a,(old_lease->>'token')::uuid,now()-interval '1 day',now()+interval '1 day','[]') then raise exception 'An old sync lease overwrote newly configured sources'; end if;
  if not exists(select 1 from public.personal_schedule_items where id='event-a-'||a) then raise exception 'Configuring B deleted A''s imported item'; end if;
  insert into public.personal_schedule_items(id,user_id,source,resource_id,provider_id,title,starts_at,ends_at,busy) values
    ('event-b-'||a,a,'google-event','calendar-b','event-b','PRIVATE B',now()-interval '5 minutes',now()+interval '30 minutes',true);
  perform public.set_schedule_busy_sharing(home_a,true);
  perform public.set_schedule_busy_sharing(home_b,true);
  update public.personal_schedule_preferences set synced_at=now() where user_id=a;
  perform set_config('request.jwt.claim.sub',b::text,true);
  select ends_at into activity_end from public.get_household_schedule_activity(home_b) where member_id=a;
  if activity_end is distinct from now()+interval '30 minutes' then raise exception 'Busy status used a calendar from a different household'; end if;
  perform set_config('role','authenticated',true);
  if exists(select 1 from public.member_schedule_preferences where user_id=a) then raise exception 'A roommate can read another person''s private calendar selections'; end if;
  if exists(select 1 from public.personal_schedule_items where user_id=a) then raise exception 'A roommate can read another person''s imported items'; end if;
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.configure_household_schedule(home_b,'{}','{}','America/Los_Angeles',false);
  if not (select enabled from public.member_schedule_preferences where user_id=a and household_id=home_a)
    or (select calendar_ids from public.personal_schedule_preferences where user_id=a)<>array['calendar-a']
    or not exists(select 1 from public.personal_schedule_items where id='event-a-'||a)
    then raise exception 'Pausing B disrupted A'; end if;
  if exists(select 1 from public.member_schedule_sharing where user_id=a and household_id=home_b and enabled) then raise exception 'Pausing B left busy sharing on'; end if;
  if exists(select 1 from public.personal_schedule_items where id='event-b-'||a) then raise exception 'Unselected B-only cache was retained'; end if;
  -- A household created after configuration must also start completely fresh.
  insert into public.households(id,name,invite_code,created_by) values(fresh_home,'Fresh home',fresh_home::text,a);
  insert into public.household_members(household_id,user_id,display_name,role,status) values(fresh_home,a,'Avery','owner','active');
  if exists(select 1 from public.member_schedule_preferences where household_id=fresh_home) then raise exception 'Creating a household automatically connected Google'; end if;
  denied:=false;
  begin perform public.configure_household_schedule(home_a,array[]::text[],array[]::text[],'UTC',true); exception when others then denied:=true; end;
  if not denied then raise exception 'Empty enabled source selections were accepted'; end if;
  if (select calendar_ids from public.member_schedule_preferences where user_id=a and household_id=home_a)<>array['calendar-a'] then raise exception 'Invalid input partially changed existing settings'; end if;
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  denied:=false;
  begin perform public.configure_household_schedule(home_a,array['stolen'],'{}','UTC',true); exception when others then denied:=true; end;
  if not denied then raise exception 'An outsider configured another household'; end if;
  denied:=false;
  begin perform public.get_household_schedule_activity(home_a); exception when others then denied:=true; end;
  if not denied then raise exception 'An outsider read household busy status'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true);
  insert into public.google_calendar_connections(user_id,refresh_token) values(a,'test-placeholder');
  delete from public.google_calendar_connections where user_id=a;
  if exists(select 1 from public.member_schedule_preferences where user_id=a and enabled) or exists(select 1 from public.personal_schedule_items where user_id=a) then raise exception 'Explicit account disconnect did not disable every household'; end if;
  raise notice 'Household-specific setup, source union, preserved settings/cache, stale leases, new households, busy privacy, RLS, validation and disconnect passed';
end;
$$;
rollback;
