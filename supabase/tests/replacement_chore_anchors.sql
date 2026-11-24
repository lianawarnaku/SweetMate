begin;
do $$
declare
  host_id uuid := gen_random_uuid(); member_id uuid := gen_random_uuid(); outsider_id uuid := gen_random_uuid();
  home_id uuid := gen_random_uuid(); chart_id uuid := gen_random_uuid(); invalid_chart_id uuid := gen_random_uuid();
  today date := (clock_timestamp() at time zone 'UTC')::date; floor_day date := today + 1;
  payload jsonb; rows jsonb; saved jsonb; after_rows jsonb; history_facts jsonb; denied boolean := false;
  future_id text; debt_id text; manual_id text;
begin
  insert into auth.users(id,email) values(host_id,host_id||'@chart-replacement.invalid'),(member_id,member_id||'@chart-replacement.invalid'),(outsider_id,outsider_id||'@chart-replacement.invalid');
  insert into public.households(id,name,invite_code,created_by,timezone) values(home_id,'Replacement regression',home_id::text,host_id,'UTC');
  insert into public.household_members(household_id,user_id,display_name,role,status) values(home_id,host_id,'Avery','owner','active'),(home_id,member_id,'Blake','member','active');
  perform set_config('request.jwt.claim.sub',host_id::text,true);
  perform set_config('request.headers','{"x-sweetmate-chore-policy":"single-obligation-v1"}',true);
  future_id := 'chart:'||chart_id||':future'; debt_id := 'chart:'||chart_id||':debt'; manual_id := 'manual-'||home_id;
  insert into public.chores(id,household_id,title,creator_id,assigned_to,source_key,due_date,scheduled_date,recurrence_series_id,recurring,assignment_mode,assignment_locked,created_at,completed,completed_at,completed_by_user_id)
  values
    ('old-future-'||home_id,home_id,'Future work',host_id,host_id,'future',today+7,today+7,'old-future-series-'||home_id,'weekly','specific-person',false,now()-interval '1 day',false,null,null),
    ('old-debt-'||home_id,home_id,'Retained work',host_id,member_id,'debt',today-1,today-1,'old-debt-series-'||home_id,'daily','specific-person',false,now()-interval '1 day',false,null,null),
    (manual_id,home_id,'Manual work',host_id,host_id,'manual',today+4,today+4,'manual-series-'||home_id,'weekly','specific-person',true,now()-interval '1 day',false,null,null),
    ('completed-'||home_id,home_id,'Future work',host_id,host_id,'future',today-2,today-2,'history-series-'||home_id,'weekly','specific-person',false,now()-interval '2 days',true,now()-interval '2 days',host_id);
  select jsonb_build_object('assigned',assigned_to,'due',due_date,'completed',completed,'completedAt',completed_at,'completedBy',completed_by_user_id) into history_facts from public.chores where id='completed-'||home_id;
  payload := jsonb_build_object('version',2,'rotation','round-robin','generatedTasks',jsonb_build_array(
    jsonb_build_object('id','future','title','Future work','itemCategory','kitchen','difficulty',2,'frequency','weekly','timeOfDay','any'),
    jsonb_build_object('id','debt','title','Retained work','itemCategory','kitchen','difficulty',2,'frequency','daily','timeOfDay','any'),
    jsonb_build_object('id','manual','title','Manual work','itemCategory','kitchen','difficulty',2,'frequency','weekly','timeOfDay','any')),
    'assignments',jsonb_build_array(jsonb_build_object('memberId',host_id,'taskIds',jsonb_build_array('debt','manual'),'totalLoad',16),jsonb_build_object('memberId',member_id,'taskIds',jsonb_build_array('future'),'totalLoad',2)),
    'pinnedAssignments',jsonb_build_object('future',member_id,'debt',host_id,'manual',host_id),'excludedAssignments','{}'::jsonb);
  insert into public.proposed_charts(id,household_id,created_by,status,payload) values(chart_id,home_id,host_id,'approved',payload);
  insert into public.proposed_chart_approvals(household_id,proposed_chart_id,member_id,approved) values(home_id,chart_id,host_id,true),(home_id,chart_id,member_id,true);
  select jsonb_agg(jsonb_build_object('id',case task->>'id' when 'future' then future_id else debt_id end,
    'household_id',home_id,'title',task->>'title','source_key',task->>'id','creator_id',host_id,
    'assigned_to',case task->>'id' when 'future' then member_id else host_id end,
    'assignment_mode','specific-person','assignment_locked',false,'round_robin_participant_ids','[]'::jsonb,'round_robin_all_members',false,'round_robin_cursor',0,
    'excluded_participant_ids','[]'::jsonb,'excluded_occurrence_dates','[]'::jsonb,'occurrence_index',0,
    'due_date',((case task->>'id' when 'future' then today+7 else floor_day end)::timestamp at time zone 'UTC')+interval '12 hours',
    'scheduled_date',case task->>'id' when 'future' then today+7 else floor_day end,'materialization_starts_on',floor_day,
    'completed',false,'points',10,'category','kitchen','time_of_day','any','recurring',task->>'frequency',
    'recurrence_series_id',case task->>'id' when 'future' then future_id else debt_id end,
    'chore_definition_id','source:'||(task->>'id'),'chore_definition',jsonb_build_object('id','source:'||(task->>'id'),'seriesId',case task->>'id' when 'future' then future_id else debt_id end,'updatedAt',clock_timestamp())
  )) into rows from jsonb_array_elements(payload->'generatedTasks') task where task->>'id'<>'manual';
  select rows || jsonb_build_array(to_jsonb(c)||jsonb_build_object('points',10,'category','kitchen')) into rows from public.chores c where id=manual_id;
  perform set_config('request.jwt.claim.sub',member_id::text,true);
  perform public.apply_approved_chore_chart(chart_id,rows);
  if not exists(select 1 from public.chores where id=future_id and assigned_to=member_id and skipped_at is null and not completed and scheduled_date=today+7)
    or exists(select 1 from public.chores where id='old-future-'||home_id)
  then raise exception 'Replacement anchor was suppressed by the old future occurrence'; end if;
  if not exists(select 1 from public.chores where id='old-debt-'||home_id and assigned_to=member_id and skipped_at is null and not completed)
    or not exists(select 1 from public.chores where id=debt_id and skipped_reason='schedule-replaced')
  then raise exception 'Outstanding debt must keep its original owner without duplicate active obligations'; end if;
  if not exists(select 1 from public.chores where id=manual_id and assigned_to=host_id and assignment_locked and scheduled_date=today+4 and skipped_at is null)
  then raise exception 'Replacement changed the protected manual assignment'; end if;
  if history_facts is distinct from (select jsonb_build_object('assigned',assigned_to,'due',due_date,'completed',completed,'completedAt',completed_at,'completedBy',completed_by_user_id) from public.chores where id='completed-'||home_id)
  then raise exception 'Replacement rewrote completed history'; end if;
  if (select count(*) from public.proposed_chart_approvals where proposed_chart_id=chart_id and approved)<>2 or not exists(select 1 from public.proposed_charts where id=chart_id and applied_at is not null)
  then raise exception 'Replacement lost approvals or application state'; end if;
  select jsonb_agg(to_jsonb(c) order by id) into saved from public.chores c where household_id=home_id;
  perform public.apply_approved_chore_chart(chart_id,rows);
  select jsonb_agg(to_jsonb(c) order by id) into after_rows from public.chores c where household_id=home_id;
  if saved is distinct from after_rows then raise exception 'Applying the same chart twice changed chores'; end if;
  insert into public.proposed_charts(id,household_id,created_by,status,payload,created_at) values(invalid_chart_id,home_id,host_id,'approved',payload,clock_timestamp()+interval '1 second');
  begin
    perform public.apply_approved_chore_chart(invalid_chart_id,'[]'::jsonb);
  exception when others then denied:=true;
  end;
  select jsonb_agg(to_jsonb(c) order by id) into after_rows from public.chores c where household_id=home_id;
  if not denied or saved is distinct from after_rows then raise exception 'Rejected chart must roll back retirement and all chore writes'; end if;
  denied:=false;
  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  begin perform public.apply_approved_chore_chart(invalid_chart_id,rows); exception when others then denied:=true; end;
  if not denied then raise exception 'Outsider applied a household chart'; end if;
end;
$$;
rollback;
select 'Replacement anchors, retained debt, manual assignments, history, approvals, idempotency, rollback and authorization passed' as result;
