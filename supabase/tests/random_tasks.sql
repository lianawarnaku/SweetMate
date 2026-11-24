-- Regression fixtures and all created tasks/chores are rolled back.
begin;
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid(); former uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  home uuid := gen_random_uuid(); solo uuid := gen_random_uuid(); foreign_home uuid := gen_random_uuid();
  open_id uuid := gen_random_uuid(); random_id uuid := gen_random_uuid(); expired_id uuid := gen_random_uuid(); late_id uuid := gen_random_uuid();
  solo_id uuid := gen_random_uuid(); retry_id uuid; record public.household_random_tasks%rowtype; chore public.chores%rowtype;
  snapshot jsonb; original_chore jsonb; denied boolean; person uuid; n integer;
begin
  insert into auth.users(id, email) values (a, a::text || '@random-test.invalid'), (b, b::text || '@random-test.invalid'),
    (c, c::text || '@random-test.invalid'), (former, former::text || '@random-test.invalid'), (outsider, outsider::text || '@random-test.invalid');
  insert into public.households(id, name, invite_code, created_by) values (home, 'Random task regression', home::text, a),
    (solo, 'Solo regression', solo::text, a), (foreign_home, 'Foreign regression', foreign_home::text, outsider);
  insert into public.household_members(household_id, user_id, display_name, role, status) values
    (home, a, 'Avery', 'owner', 'active'), (home, b, 'Blake', 'member', 'active'), (home, c, 'Casey', 'member', 'active'),
    (home, former, 'Former member', 'member', 'left'), (solo, a, 'Avery', 'owner', 'active'), (foreign_home, outsider, 'Outsider', 'owner', 'active');
  perform set_config('request.jwt.claim.sub', a::text, true);
  perform set_config('request.headers', '{"x-sweetmate-chore-policy":"single-obligation-v1"}', true);
  insert into public.chores(id, household_id, title, creator_id, assigned_to, due_date)
    values ('existing-' || home, home, 'Existing chore', a, b, now());
  select to_jsonb(ch) into original_chore from public.chores ch where id = 'existing-' || home;

  perform public.create_household_random_task(home, open_id, '  Collect recycling  ', 'up-for-grabs');
  select * into record from public.household_random_tasks where id = open_id;
  if record.title <> 'Collect recycling' or record.claim_deadline <> record.created_at + interval '24 hours'
    or record.assigned_at is not null or record.chore_id is not null
  then raise exception 'An open task must have a 24-hour claim window without an assigned chore'; end if;
  retry_id := public.create_household_random_task(home, open_id, 'Collect recycling', 'up-for-grabs');
  if retry_id <> open_id or (select count(*) from public.household_random_tasks where id = open_id) <> 1 then raise exception 'Create retries must be idempotent'; end if;
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform set_config('role', 'authenticated', true);
  if (select count(*) from public.household_random_tasks where household_id = home) <> 1 then raise exception 'Other active roommates must see the task'; end if;
  if exists(select 1 from public.household_random_tasks where household_id = foreign_home) then raise exception 'Random tasks leaked across households'; end if;
  perform public.claim_household_random_task(home, open_id);
  perform set_config('role', 'postgres', true);
  select * into record from public.household_random_tasks where id = open_id;
  select * into chore from public.chores where id = record.chore_id;
  if record.assignment_kind <> 'claimed' or chore.assigned_to <> b or chore.due_date <> record.assigned_at + interval '24 hours'
    or not chore.assignment_locked or chore.recurring is not null or chore.assignment_mode <> 'specific-person'
  then raise exception 'Claim must atomically create a single one-time chore due 24 hours later'; end if;
  perform public.claim_household_random_task(home, open_id);
  if (select count(*) from public.chores where id = record.chore_id) <> 1 then raise exception 'Claim retry created duplicate chores'; end if;
  perform set_config('request.jwt.claim.sub', c::text, true);
  denied := false;
  begin perform public.claim_household_random_task(home, open_id); exception when others then
    if sqlerrm <> 'This task has already been claimed or assigned.' then raise; end if; denied := true;
  end;
  if not denied or (select assigned_to from public.chores where id = record.chore_id) <> b then raise exception 'Second claimant overwrote the winner'; end if;

  -- A regular member can create either kind; random selection includes the creator.
  perform public.create_household_random_task(home, random_id, 'Wipe the counter', 'random');
  select * into record from public.household_random_tasks where id = random_id;
  select * into chore from public.chores where id = record.chore_id;
  if record.assignment_kind <> 'random' or record.claim_deadline is not null or not (chore.assigned_to = any(array[a,b,c]))
    or chore.due_date <> record.assigned_at + interval '24 hours'
  then raise exception 'Immediate random task must be assigned to a current member'; end if;
  perform public.create_household_random_task(home, random_id, 'Wipe the counter', 'random');
  if (select count(*) from public.chores where source_key = 'random-task:' || random_id::text) <> 1 then raise exception 'Immediate draw retry created extra work'; end if;
  perform set_config('request.jwt.claim.sub', a::text, true);
  perform public.create_household_random_task(solo, solo_id, 'One person task', 'random');
  if not exists(select 1 from public.household_random_tasks t join public.chores ch on ch.id=t.chore_id where t.id=solo_id and ch.assigned_to=a)
  then raise exception 'The creator must remain eligible for a random draw'; end if;

  perform public.create_household_random_task(home, expired_id, 'Expired open task', 'up-for-grabs');
  update public.household_random_tasks set claim_deadline = clock_timestamp() - interval '1 second' where id = expired_id;
  update public.household_members set status = 'left' where household_id = home and user_id = a;
  -- Same privileged entry point used by cron; no signed-in app is required.
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.resolve_expired_random_tasks();
  select * into record from public.household_random_tasks where id = expired_id;
  select * into chore from public.chores where id = record.chore_id;
  if record.assignment_kind <> 'random' or not (chore.assigned_to = any(array[b,c]))
    or chore.due_date <> record.assigned_at + interval '24 hours'
  then raise exception 'Background expiry must draw only from currently active roommates'; end if;
  perform public.resolve_expired_random_tasks();
  if (select count(*) from public.chores where source_key = 'random-task:' || expired_id::text) <> 1 then raise exception 'Repeated scheduler ticks duplicated a task'; end if;
  update public.household_members set status = 'active' where household_id = home and user_id = a;
  perform set_config('request.jwt.claim.sub', a::text, true);
  perform public.create_household_random_task(home, late_id, 'Late claim task', 'up-for-grabs');
  update public.household_random_tasks set claim_deadline = clock_timestamp() - interval '1 second' where id = late_id;
  perform public.claim_household_random_task(home, late_id);
  if (select assignment_kind from public.household_random_tasks where id = late_id) <> 'random' then raise exception 'A late claimant bypassed the server deadline'; end if;
  snapshot := public.get_household_random_tasks(home);
  if snapshot->>'householdId' <> home::text or jsonb_array_length(snapshot->'tasks') <> 4 or jsonb_array_length(snapshot->'chores') <> 4
  then raise exception 'Shared snapshot must return all current tasks and their saved chores'; end if;
  if (select to_jsonb(ch) from public.chores ch where id = 'existing-' || home) is distinct from original_chore then raise exception 'Random tasks changed existing chores'; end if;

  foreach person in array array[former, outsider] loop
    perform set_config('request.jwt.claim.sub', person::text, true);
    perform set_config('role', 'authenticated', true);
    if exists(select 1 from public.household_random_tasks where household_id=home) then raise exception 'Non-members can read random tasks'; end if;
    perform set_config('role', 'postgres', true);
    for n in 1..3 loop
      denied := false;
      begin
        if n=1 then perform public.get_household_random_tasks(home);
        elsif n=2 then perform public.create_household_random_task(home, gen_random_uuid(), 'Unauthorized', 'random');
        else perform public.claim_household_random_task(home, open_id); end if;
      exception when others then if sqlerrm <> 'Active household membership required' then raise; end if; denied := true;
      end;
      if not denied then raise exception 'Inactive/foreign member bypassed random task authorization'; end if;
    end loop;
  end loop;
  if has_function_privilege('authenticated','public.assign_household_random_task(uuid,uuid)','execute')
    or has_function_privilege('authenticated','public.resolve_expired_random_tasks(uuid)','execute')
    or has_table_privilege('authenticated','public.household_random_tasks','insert')
    or has_table_privilege('authenticated','public.household_random_tasks','update')
    or has_function_privilege('anon','public.create_household_random_task(uuid,uuid,text,text)','execute')
  then raise exception 'Random draw/claim permissions can be bypassed'; end if;
  if not exists(select 1 from cron.job where jobname='household-random-task-expiry' and schedule='* * * * *' and active)
  then raise exception 'The offline background assignment schedule is missing'; end if;
end;
$$;
rollback;
select 'Random task creation, claim, expiry, RLS, and saved chore tests passed' as result;
