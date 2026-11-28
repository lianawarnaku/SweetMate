-- Disposable fixtures; no existing QA or production records are modified.
begin;
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); h uuid := gen_random_uuid();
  old_chart uuid; current_chart uuid; payload jsonb; denied boolean;
  failures text[] := '{}';
begin
  insert into auth.users(id,email) values(a,a::text||'@reliability.invalid'),(b,b::text||'@reliability.invalid');
  insert into public.households(id,name,invite_code,created_by) values(h,'Stale approval regression',h::text,a);
  insert into public.household_members(household_id,user_id,display_name,role,status)
    values(h,a,'A','owner','active'),(h,b,'B','member','active');
  payload:=jsonb_build_object('version',2,'rotation','round-robin','generatedTasks','[]'::jsonb,
    'pinnedAssignments','{}'::jsonb,'excludedAssignments','{}'::jsonb,
    'assignments',jsonb_build_array(jsonb_build_object('memberId',a,'taskIds','[]'::jsonb,'totalLoad',0),jsonb_build_object('memberId',b,'taskIds','[]'::jsonb,'totalLoad',0)));
  perform set_config('request.jwt.claim.sub',a::text,true);
  old_chart:=public.replace_proposed_chart(h,payload);
  perform public.approve_proposed_chart(old_chart);
  perform set_config('request.jwt.claim.sub',b::text,true);
  perform public.approve_proposed_chart(old_chart);
  current_chart:=public.restart_chore_chart_review(h);
  -- A stale UI may still offer Approve after its former chart was approved and restarted.
  denied:=false;
  begin perform public.approve_proposed_chart(old_chart);
  exception when others then
    if sqlerrm not like '%chart has changed%' then raise; end if;
    denied:=true;
  end;
  if not denied then failures:=array_append(failures,'historical approval reports success'); end if;
  -- Check the host override separately.
  perform set_config('request.jwt.claim.sub',a::text,true);
  denied:=false;
  begin perform public.force_approve_proposed_chart(old_chart);
  exception when others then
    if sqlerrm not like '%chart has changed%' then raise; end if;
    denied:=true;
  end;
  if not denied then failures:=array_append(failures,'historical override reports success'); end if;
  denied:=false;
  begin perform public.apply_approved_chore_chart(old_chart,'[]'::jsonb);
  exception when others then
    if sqlerrm not like '%chart has changed%' then raise; end if;
    denied:=true;
  end;
  if not denied then failures:=array_append(failures,'historical unapplied chart activates during a fresh review'); end if;
  if exists(select 1 from public.proposed_chart_approvals where proposed_chart_id=current_chart and approved)
    then raise exception 'Stale action approved the replacement'; end if;
  if cardinality(failures)>0 then raise exception 'Stale chart regressions: %',array_to_string(failures,', '); end if;
  -- Current votes and duplicate acknowledgements remain valid.
  if public.approve_proposed_chart(current_chart)<>'pending' then raise exception 'First current vote failed'; end if;
  perform set_config('request.jwt.claim.sub',b::text,true);
  if public.approve_proposed_chart(current_chart)<>'approved' then raise exception 'Final current vote failed'; end if;
  if public.approve_proposed_chart(current_chart)<>'approved' then raise exception 'Current duplicate vote is not idempotent'; end if;
  perform public.apply_approved_chore_chart(current_chart,'[]'::jsonb);
  perform public.apply_approved_chore_chart(current_chart,'[]'::jsonb);
  if not(public.get_household_chart_completion(h)->>'complete')::boolean then raise exception 'Current review did not complete'; end if;
end $$;
rollback;
select 'Stale chart approval and activation tests passed' as result;
