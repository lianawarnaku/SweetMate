-- Run against a local migrated database with psql -v ON_ERROR_STOP=1.
-- Fixtures and every review operation are rolled back at the end.
begin;
do $$
declare
  host_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  inactive_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  sweet_id uuid := gen_random_uuid();
  other_sweet_id uuid := gen_random_uuid();
  empty_sweet_id uuid := gen_random_uuid();
  applied_id uuid := gen_random_uuid();
  other_chart_id uuid := gen_random_uuid();
  restarted_id uuid;
  restarted_again_id uuid;
  revised_id uuid;
  chart_payload jsonb;
  revised_payload jsonb;
  original_chart jsonb;
  original_other_chart jsonb;
  saved_records jsonb;
  after_records jsonb;
  denied boolean;
begin
  insert into auth.users(id, email) values
    (host_id, host_id::text || '@restart-test.invalid'),
    (member_id, member_id::text || '@restart-test.invalid'),
    (inactive_id, inactive_id::text || '@restart-test.invalid'),
    (outsider_id, outsider_id::text || '@restart-test.invalid');
  insert into public.households(id, name, invite_code, created_by) values
    (sweet_id, 'Restart regression', sweet_id::text, host_id),
    (other_sweet_id, 'Unrelated regression', other_sweet_id::text, host_id),
    (empty_sweet_id, 'First chart regression', empty_sweet_id::text, host_id);
  insert into public.household_members(household_id, user_id, display_name, role, status) values
    (sweet_id, host_id, 'Avery', 'owner', 'active'),
    (sweet_id, member_id, 'Blake', 'member', 'active'),
    (sweet_id, inactive_id, 'Former Sweetmate', 'member', 'left'),
    (other_sweet_id, host_id, 'Avery', 'owner', 'active'),
    (empty_sweet_id, host_id, 'Avery', 'owner', 'active');
  perform set_config('request.jwt.claim.sub', host_id::text, true);
  perform set_config('request.headers', '{"x-sweetmate-chore-policy":"single-obligation-v1"}', true);
  insert into public.household_states(household_key, household_id, state, updated_by)
    values (sweet_id::text, sweet_id, '{"householdComplete":true,"homeProfile":{"housingType":"apartment","items":["Dishwasher"]},"customTasks":[{"id":"saved-custom","title":"Water plants"}]}', host_id);
  insert into public.member_task_preferences(household_id, member_id, key, value)
    values (sweet_id, host_id, 'morning', 33), (sweet_id, member_id, 'night', 75);
  insert into public.item_difficulty(household_id, category, item, difficulty)
    values (sweet_id, 'kitchen', 'Dishwasher', 2);
  insert into public.chores(id, household_id, title, assigned_to, creator_id, due_date, scheduled_date, assignment_locked, completed, completed_at, completed_by_user_id)
    values
      ('restart-manual-' || sweet_id, sweet_id, 'Saved manual chore', host_id, host_id, now(), current_date, true, false, null, null),
      ('restart-completed-' || sweet_id, sweet_id, 'Saved completed chore', member_id, host_id, now(), current_date, false, true, now(), member_id);
  chart_payload := jsonb_build_object(
    'version', 2, 'rotation', 'round-robin',
    'generatedTasks', jsonb_build_array(jsonb_build_object('id', 'restart-task', 'title', 'Clean dishwasher', 'itemCategory', 'kitchen', 'difficulty', 2, 'frequency', 'weekly', 'timeOfDay', 'any')),
    'assignments', jsonb_build_array(jsonb_build_object('memberId', host_id, 'taskIds', jsonb_build_array('restart-task'), 'totalLoad', 2), jsonb_build_object('memberId', member_id, 'taskIds', '[]'::jsonb, 'totalLoad', 0)),
    'pinnedAssignments', jsonb_build_object('restart-task', host_id),
    'excludedAssignments', jsonb_build_object('restart-task', jsonb_build_array(member_id))
  );
  insert into public.proposed_charts(id, household_id, created_by, status, payload, applied_at)
    values (applied_id, sweet_id, host_id, 'approved', chart_payload, now());
  insert into public.proposed_chart_approvals(household_id, proposed_chart_id, member_id, approved)
    values (sweet_id, applied_id, host_id, true), (sweet_id, applied_id, member_id, true);
  insert into public.proposed_charts(id, household_id, created_by, status, payload)
    values (other_chart_id, other_sweet_id, host_id, 'pending', chart_payload);
  select to_jsonb(p) into original_chart from public.proposed_charts p where id = applied_id;
  select to_jsonb(p) into original_other_chart from public.proposed_charts p where id = other_chart_id;
  saved_records := jsonb_build_object(
    'members', (select jsonb_agg(to_jsonb(m) order by user_id) from public.household_members m where household_id = sweet_id),
    'state', (select to_jsonb(s) from public.household_states s where household_id = sweet_id),
    'chores', (select jsonb_agg(to_jsonb(c) order by id) from public.chores c where household_id = sweet_id),
    'preferences', (select jsonb_agg(to_jsonb(p) order by id) from public.member_task_preferences p where household_id = sweet_id),
    'difficulty', (select jsonb_agg(to_jsonb(d) order by id) from public.item_difficulty d where household_id = sweet_id)
  );

  -- A regular member can restart an applied chart. Both votes must reset.
  perform set_config('request.jwt.claim.sub', member_id::text, true);
  restarted_id := public.restart_chore_chart_review(sweet_id);
  if restarted_id is null or restarted_id = applied_id then raise exception 'Restart did not create a fresh review'; end if;
  if (public.get_household_chart_review(sweet_id)->'chart'->>'id') <> restarted_id::text
    or jsonb_array_length(public.get_household_chart_review(sweet_id)->'approvals') <> 2
    or exists (select 1 from jsonb_array_elements(public.get_household_chart_review(sweet_id)->'approvals') vote where (vote->>'approved')::boolean)
  then raise exception 'Fresh review snapshot must contain the new chart and only its unapproved votes'; end if;
  if (select count(*) from public.chore_chart_restart_notifications n where n.chart_id = restarted_id) <> 1
    or not exists (select 1 from public.chore_chart_restart_notifications n where n.chart_id = restarted_id and n.recipient_id = host_id and n.actor_id = member_id and n.actor_name = 'Blake' and n.read_at is null)
    or exists (select 1 from public.chore_chart_restart_notifications n where n.chart_id = restarted_id and n.recipient_id in (member_id, inactive_id))
  then raise exception 'Restart must alert every other active member, excluding the actor and inactive members'; end if;
  perform set_config('role', 'authenticated', true);
  if exists (select 1 from public.chore_chart_restart_notifications n where n.chart_id = restarted_id)
  then raise exception 'Actor must not read the other recipient notification'; end if;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', host_id::text, true);
  perform set_config('role', 'authenticated', true);
  if (select count(*) from public.chore_chart_restart_notifications n where n.chart_id = restarted_id) <> 1
  then raise exception 'Recipient must be able to read the restart notification'; end if;
  update public.chore_chart_restart_notifications n set read_at = now() where n.chart_id = restarted_id;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', member_id::text, true);
  if not exists (select 1 from public.chore_chart_restart_notifications n where n.chart_id = restarted_id and n.read_at is not null)
  then raise exception 'Recipient read receipt must be saved'; end if;

  if (public.get_household_chart_completion(sweet_id)->>'complete')::boolean
    or public.get_household_chart_completion(sweet_id)->>'chartId' <> restarted_id::text
  then raise exception 'Completion must follow the pending restart instead of an older applied chart'; end if;
  if not exists (select 1 from public.proposed_charts where id = restarted_id and status = 'pending' and applied_at is null and payload = chart_payload and created_by = member_id)
  then raise exception 'Restart lost saved rules or retained applied status'; end if;
  if (select count(*) from public.proposed_chart_approvals where proposed_chart_id = restarted_id) <> 2
    or exists (select 1 from public.proposed_chart_approvals where proposed_chart_id = restarted_id and approved)
  then raise exception 'Every active member must start Pending'; end if;
  if (select to_jsonb(p) from public.proposed_charts p where id = applied_id) is distinct from original_chart
    or (select count(*) from public.proposed_chart_approvals where proposed_chart_id = applied_id and approved) <> 2
  then raise exception 'Restart must preserve the applied chart and historical approvals'; end if;

  -- Restarting a partially approved proposal cancels only that draft.
  perform set_config('request.jwt.claim.sub', host_id::text, true);
  if public.approve_proposed_chart(restarted_id) <> 'pending' then raise exception 'First approval incorrectly completed review'; end if;
  if not exists (select 1 from jsonb_array_elements(public.get_household_chart_review(sweet_id)->'approvals') vote where vote->>'member_id' = host_id::text and (vote->>'approved')::boolean)
    or exists (select 1 from jsonb_array_elements(public.get_household_chart_review(sweet_id)->'approvals') vote where vote->>'member_id' = member_id::text and (vote->>'approved')::boolean)
  then raise exception 'Fresh snapshot must preserve Avery approved and Blake pending after restart'; end if;

  if (public.get_household_chart_completion(sweet_id)->>'complete')::boolean
    or (public.get_household_chart_completion(sweet_id)->>'approvedCount')::integer <> 1
  then raise exception 'One pending roommate must keep household chart incomplete'; end if;
  perform set_config('request.jwt.claim.sub', member_id::text, true);
  restarted_again_id := public.restart_chore_chart_review(sweet_id);
  if restarted_again_id = restarted_id
    or (select status from public.proposed_charts where id = restarted_id) <> 'cancelled'
    or (select count(*) from public.proposed_chart_approvals where proposed_chart_id = restarted_again_id and not approved) <> 2
  then raise exception 'Restart must reset a partially approved review for everyone'; end if;
  if (select count(*) from public.proposed_charts where household_id = sweet_id and status = 'pending') <> 1
  then raise exception 'Restart left multiple current reviews'; end if;

  -- Editing and resending the reset chart must leave both people able to approve.
  revised_payload := jsonb_set(jsonb_set(chart_payload, '{generatedTasks,0,difficulty}', '3'), '{assignments,0,totalLoad}', '3');
  revised_id := public.submit_chore_chart_review(sweet_id, revised_payload, restarted_again_id, false);
  if (select count(*) from public.proposed_chart_approvals where proposed_chart_id = revised_id and not approved) <> 2
  then raise exception 'Resending the edited chart must keep both members Pending'; end if;
  if public.approve_proposed_chart(revised_id) <> 'pending' then raise exception 'Member could not reapprove the edited chart'; end if;
  perform set_config('request.jwt.claim.sub', host_id::text, true);
  if public.approve_proposed_chart(revised_id) <> 'approved' then raise exception 'Both fresh approvals must complete review'; end if;
  if (public.get_household_chart_completion(sweet_id)->>'complete')::boolean
  then raise exception 'Completion must wait for successful chart activation'; end if;
  update public.proposed_charts set applied_at = now() where id = revised_id;
  if not (public.get_household_chart_completion(sweet_id)->>'complete')::boolean
  then raise exception 'The latest applied chart with both approvals must be complete'; end if;
  update public.proposed_chart_approvals a set approved = false where a.proposed_chart_id = revised_id and a.member_id = host_id;
  if (public.get_household_chart_completion(sweet_id)->>'complete')::boolean
  then raise exception 'A missing active vote must override an inconsistent approved chart status'; end if;
  update public.proposed_chart_approvals a set approved = true where a.proposed_chart_id = revised_id and a.member_id = host_id;


  after_records := jsonb_build_object(
    'members', (select jsonb_agg(to_jsonb(m) order by user_id) from public.household_members m where household_id = sweet_id),
    'state', (select to_jsonb(s) from public.household_states s where household_id = sweet_id),
    'chores', (select jsonb_agg(to_jsonb(c) order by id) from public.chores c where household_id = sweet_id),
    'preferences', (select jsonb_agg(to_jsonb(p) order by id) from public.member_task_preferences p where household_id = sweet_id),
    'difficulty', (select jsonb_agg(to_jsonb(d) order by id) from public.item_difficulty d where household_id = sweet_id)
  );
  if after_records is distinct from saved_records then raise exception 'Restart or review changed saved household records'; end if;
  if (select to_jsonb(p) from public.proposed_charts p where id = other_chart_id) is distinct from original_other_chart
  then raise exception 'Restart changed another household'; end if;
  if public.restart_chore_chart_review(empty_sweet_id) is not null
    or exists (select 1 from public.proposed_charts where household_id = empty_sweet_id)
  then raise exception 'A household without a chart must remain ready for its first preview'; end if;

  -- Inactive members, outsiders, and unauthenticated callers cannot reset votes.
  foreach inactive_id in array array[inactive_id, outsider_id] loop
    perform set_config('request.jwt.claim.sub', inactive_id::text, true);
    denied := false;
    begin perform public.restart_chore_chart_review(sweet_id);
    exception when others then
      if sqlerrm <> 'Active household membership required' then raise; end if;
      denied := true;
    end;
    if not denied then raise exception 'Unauthorized restart was accepted'; end if;
    denied := false;
    begin perform public.get_household_chart_review(sweet_id);
    exception when others then
      if sqlerrm <> 'Active household membership required' then raise; end if;
      denied := true;
    end;
    if not denied then raise exception 'Unauthorized review snapshot was readable'; end if;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  denied := false;
  begin perform public.restart_chore_chart_review(sweet_id);
  exception when others then
    if sqlerrm <> 'Active household membership required' then raise; end if;
    denied := true;
  end;
  if not denied then raise exception 'Anonymous restart was accepted'; end if;
  if has_function_privilege('anon', 'public.restart_chore_chart_review(uuid)', 'execute')
    or not has_function_privilege('authenticated', 'public.restart_chore_chart_review(uuid)', 'execute')
  then raise exception 'Incorrect restart RPC permissions'; end if;
end;
$$;
rollback;
select 'Restart chart review regression tests passed' as result;
