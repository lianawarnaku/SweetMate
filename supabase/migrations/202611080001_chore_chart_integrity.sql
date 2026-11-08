-- Chart proposals are immutable snapshots. Votes and chart application go through
-- serialized RPCs; client RLS cannot bypass the approval state machine.
alter table public.item_difficulty drop constraint if exists item_difficulty_category_check;
alter table public.item_difficulty add constraint item_difficulty_category_check
  check (category in ('kitchen', 'bathroom', 'living', 'bedroom', 'laundry', 'other'));
alter table public.chores drop constraint if exists chores_recurring_check;
alter table public.chores add constraint chores_recurring_check
  check (recurring in ('daily', 'everyOtherDay', 'everyThreeDays', 'weekly', 'biweekly', 'monthly'));
alter table public.chores add column if not exists time_of_day text not null default 'any'
  check (time_of_day in ('morning', 'night', 'any'));
alter table public.chores add column if not exists assignment_locked boolean not null default false;
alter table public.proposed_charts add column if not exists applied_at timestamptz;

-- Retirement is durable across offline clients replaying old normalized rows.
-- A stale snapshot cannot clear a retired series' cutoff or resurrect its
-- removed future work. Completed facts may still sync and be explicitly undone.
create table public.retired_chore_series (
  household_id uuid not null references public.households(id) on delete cascade,
  recurrence_series_id text not null,
  ends_before date not null,
  retired_by_chart_id uuid references public.proposed_charts(id) on delete set null,
  primary key (household_id, recurrence_series_id)
);
alter table public.retired_chore_series enable row level security;
create policy "members read retired chore series" on public.retired_chore_series for select to authenticated
  using (public.is_household_member(household_id));
revoke all on public.retired_chore_series from public, anon, authenticated;
grant select on public.retired_chore_series to authenticated;

create or replace function public.enforce_chore_series_retirement()
returns trigger language plpgsql security definer set search_path = public
as $$
declare cutoff date; occurrence_date date;
begin
  if new.recurrence_series_id is null then return new; end if;
  select ends_before into cutoff from public.retired_chore_series
    where household_id = new.household_id and recurrence_series_id = new.recurrence_series_id;
  if cutoff is null then return new; end if;
  new.recurrence_ends_on := least(coalesce(new.recurrence_ends_on, cutoff), cutoff);
  select coalesce(new.scheduled_date, (new.due_date at time zone h.timezone)::date)
    into occurrence_date from public.households h where h.id = new.household_id;
  if not new.completed and occurrence_date >= cutoff then
    if tg_op = 'INSERT' then return null; end if;
    if not old.completed then return null; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_chore_series_retirement() from public, anon, authenticated;
create trigger enforce_chore_series_retirement before insert or update on public.chores
  for each row execute function public.enforce_chore_series_retirement();

-- Add new room/appliance defaults without overwriting household overrides.
create or replace function public.seed_item_difficulty(target_household_id uuid)
returns void language plpgsql security invoker set search_path = public
as $$
begin
  if not public.is_household_member(target_household_id) then raise exception 'Household membership required'; end if;
  insert into public.item_difficulty(household_id, category, item, difficulty)
  select target_household_id, category, item, difficulty from (values
    ('kitchen', 'Mini Fridge', 4), ('kitchen', 'Stove', 4), ('kitchen', 'Trash Can', 1),
    ('kitchen', 'Microwave', 1), ('kitchen', 'Kettle', 3), ('kitchen', 'Floor', 3),
    ('kitchen', 'Coffee Machine', 3), ('kitchen', 'Dishwasher', 2),
    ('bathroom', 'Bathroom Sink', 2), ('bathroom', 'Mirror', 1), ('bathroom', 'Shower', 4),
    ('bathroom', 'Toilet', 5), ('bathroom', 'Bath Mat', 1), ('bathroom', 'Floor', 4), ('bathroom', 'Trash Can', 1),
    ('living', 'Trash Can', 1), ('living', 'Vacuum', 3), ('living', 'Laundry Basket', 2), ('living', 'Floor', 3),
    ('bedroom', 'Carpet', 3), ('bedroom', 'Bed Linens', 3),
    ('laundry', 'Washing Machine', 4), ('laundry', 'Dryer', 1), ('other', 'Trash Can', 3)
  ) defaults(category, item, difficulty)
  on conflict (household_id, category, item) do nothing;
end;
$$;

-- Retain the newest legacy pending proposal before enforcing one per household.
with ranked as (
  select id, row_number() over (partition by household_id order by created_at desc, id desc) as ordinal
  from public.proposed_charts where status = 'pending'
)
update public.proposed_charts p set status = 'cancelled'
from ranked r where p.id = r.id and r.ordinal > 1;
create unique index if not exists proposed_charts_one_pending_per_household
  on public.proposed_charts (household_id) where status = 'pending';

do $$
declare table_name text;
begin
  foreach table_name in array array['member_task_preferences', 'proposed_charts', 'proposed_chart_approvals'] loop
    execute format('drop policy if exists "household members insert" on public.%I', table_name);
    execute format('drop policy if exists "household members update" on public.%I', table_name);
    execute format('drop policy if exists "household members delete" on public.%I', table_name);
  end loop;
end $$;
create policy "members insert own preferences" on public.member_task_preferences for insert to authenticated
  with check (member_id = auth.uid() and public.is_household_member(household_id));
create policy "members update own preferences" on public.member_task_preferences for update to authenticated
  using (member_id = auth.uid() and public.is_household_member(household_id))
  with check (member_id = auth.uid() and public.is_household_member(household_id));
create policy "members delete own preferences" on public.member_task_preferences for delete to authenticated
  using (member_id = auth.uid() and public.is_household_member(household_id));
revoke insert, update, delete on public.proposed_charts, public.proposed_chart_approvals from authenticated, anon;
grant select on public.proposed_charts, public.proposed_chart_approvals to authenticated;

-- Internal helper: reject incomplete, fabricated or stale plans before a vote can
-- approve them. Loads include the unmanaged/manual workload supplied by the engine.
create or replace function public.validate_chore_chart_payload(target_household_id uuid, chart_payload jsonb)
returns void language plpgsql security definer set search_path = public
as $$
declare
  tasks jsonb;
  task jsonb;
  assignment jsonb;
  entry record;
  member_ids text[];
  task_ids text[] := '{}';
  assigned_ids text[] := '{}';
  assignment_member_ids text[] := '{}';
  task_id text;
  member_id text;
  load numeric;
  expected_load numeric;
  baseline jsonb;
  pins jsonb;
  exclusions jsonb;
begin
  -- Locks existing membership rows until proposal creation/approval completes.
  perform 1 from public.household_members where household_id = target_household_id for share;
  select array_agg(user_id::text order by user_id::text) into member_ids
    from public.household_members where household_id = target_household_id and status = 'active';
  if coalesce(cardinality(member_ids), 0) = 0 then raise exception 'No active household members'; end if;
  if jsonb_typeof(chart_payload) is distinct from 'object'
    or chart_payload ->> 'version' is distinct from '2'
    or chart_payload ->> 'rotation' is distinct from 'round-robin'
    or jsonb_typeof(chart_payload -> 'generatedTasks') is distinct from 'array'
    or jsonb_typeof(chart_payload -> 'assignments') is distinct from 'array'
  then raise exception 'Invalid chore chart payload'; end if;
  tasks := chart_payload -> 'generatedTasks';
  if jsonb_array_length(tasks) > 1000 then raise exception 'Too many chart tasks'; end if;
  baseline := coalesce(chart_payload -> 'existingLoads', '{}'::jsonb);
  pins := coalesce(chart_payload -> 'pinnedAssignments', '{}'::jsonb);
  exclusions := coalesce(chart_payload -> 'excludedAssignments', '{}'::jsonb);
  if jsonb_typeof(baseline) <> 'object' or jsonb_typeof(pins) <> 'object' or jsonb_typeof(exclusions) <> 'object'
  then raise exception 'Invalid chart constraints'; end if;
  for entry in select * from jsonb_each(baseline) loop
    if not (entry.key = any(member_ids)) or jsonb_typeof(entry.value) <> 'number'
      or (entry.value::text)::numeric not between 0 and 1000000
    then raise exception 'Invalid existing member load'; end if;
  end loop;
  for task in select value from jsonb_array_elements(tasks) loop
    task_id := task ->> 'id';
    if jsonb_typeof(task) <> 'object' or jsonb_typeof(task -> 'id') is distinct from 'string'
      or jsonb_typeof(task -> 'title') is distinct from 'string'
      or task ->> 'itemCategory' is null or task ->> 'itemCategory' not in ('kitchen', 'bathroom', 'living', 'bedroom', 'laundry', 'other')
      or nullif(trim(task_id), '') is null or length(task_id) > 512
      or task_id = any(task_ids)
      or nullif(trim(task ->> 'title'), '') is null or length(task ->> 'title') > 500
      or task ->> 'frequency' is null
      or task ->> 'frequency' not in ('daily', 'everyOtherDay', 'everyThreeDays', 'weekly', 'biweekly', 'monthly')
      or task ->> 'timeOfDay' is null or task ->> 'timeOfDay' not in ('morning', 'night', 'any')
      or jsonb_typeof(task -> 'difficulty') is distinct from 'number'
    then raise exception 'Invalid or duplicate chart task'; end if;
    if (task ->> 'difficulty')::numeric not in (1, 2, 3, 4, 5)
    then raise exception 'Invalid task difficulty'; end if;
    task_ids := array_append(task_ids, task_id);
  end loop;
  for entry in select * from jsonb_each(pins) loop
    if not (entry.key = any(task_ids)) or jsonb_typeof(entry.value) <> 'string'
      or not ((entry.value #>> '{}') = any(member_ids))
    then raise exception 'Invalid pinned assignment'; end if;
  end loop;
  for entry in select * from jsonb_each(exclusions) loop
    if not (entry.key = any(task_ids)) or jsonb_typeof(entry.value) <> 'array'
    then raise exception 'Invalid excluded assignment'; end if;
    if exists (select 1 from jsonb_array_elements(entry.value) e(value)
      where jsonb_typeof(value) <> 'string' or not ((value #>> '{}') = any(member_ids)))
      or jsonb_array_length(entry.value) <> (select count(distinct value) from jsonb_array_elements(entry.value))
      or jsonb_array_length(entry.value) >= cardinality(member_ids)
      or (entry.value ? (pins ->> entry.key))
    then raise exception 'Invalid or conflicting excluded assignment'; end if;
  end loop;
  for assignment in select value from jsonb_array_elements(chart_payload -> 'assignments') loop
    member_id := assignment ->> 'memberId';
    if jsonb_typeof(assignment) <> 'object' or member_id is null or not (member_id = any(member_ids))
      or member_id = any(assignment_member_ids)
      or jsonb_typeof(assignment -> 'taskIds') is distinct from 'array'
      or jsonb_typeof(assignment -> 'totalLoad') is distinct from 'number'
    then raise exception 'Invalid assignment member or load'; end if;
    assignment_member_ids := array_append(assignment_member_ids, member_id);
    expected_load := coalesce((baseline ->> member_id)::numeric, 0);
    for task in select value from jsonb_array_elements(assignment -> 'taskIds') loop
      task_id := task #>> '{}';
      if jsonb_typeof(task) <> 'string' or not (task_id = any(task_ids)) or task_id = any(assigned_ids)
        or (pins ? task_id and pins ->> task_id <> member_id)
        or coalesce((exclusions -> task_id) ? member_id, false)
      then raise exception 'Missing, duplicate or ineligible task assignment'; end if;
      assigned_ids := array_append(assigned_ids, task_id);
      select value into task from jsonb_array_elements(tasks) where value ->> 'id' = task_id;
      expected_load := expected_load + (task ->> 'difficulty')::numeric * case task ->> 'frequency'
        when 'daily' then 7 when 'everyOtherDay' then 3.5 when 'everyThreeDays' then 7::numeric / 3
        when 'weekly' then 1 when 'biweekly' then 0.5 when 'monthly' then 12::numeric / 52 end;
    end loop;
    load := (assignment ->> 'totalLoad')::numeric;
    if load < 0 or abs(load - expected_load) > 0.00001 then raise exception 'Incorrect member task load'; end if;
  end loop;
  if cardinality(assignment_member_ids) <> cardinality(member_ids) or cardinality(assigned_ids) <> cardinality(task_ids)
  then raise exception 'Chart must cover every active member and task exactly once'; end if;
  if chart_payload ? 'memberLoads' then
    if jsonb_typeof(chart_payload -> 'memberLoads') <> 'array'
      or jsonb_array_length(chart_payload -> 'memberLoads') <> cardinality(member_ids)
      or (select count(distinct value ->> 'memberId') from jsonb_array_elements(chart_payload -> 'memberLoads')) <> cardinality(member_ids)
    then raise exception 'Invalid chart member totals'; end if;
    for task in select value from jsonb_array_elements(chart_payload -> 'memberLoads') loop
      select value into assignment from jsonb_array_elements(chart_payload -> 'assignments')
        where value ->> 'memberId' = task ->> 'memberId';
      if assignment is null or jsonb_typeof(task -> 'totalLoad') is distinct from 'number'
        or abs((task ->> 'totalLoad')::numeric - (assignment ->> 'totalLoad')::numeric) > 0.00001
      then raise exception 'Incorrect chart member totals'; end if;
    end loop;
  end if;
end;
$$;
revoke all on function public.validate_chore_chart_payload(uuid, jsonb) from public, anon, authenticated;

create or replace function public.replace_proposed_chart(target_household_id uuid, chart_payload jsonb)
returns uuid language plpgsql security definer set search_path = public
as $$
declare new_chart_id uuid;
begin
  if auth.uid() is null or not public.is_household_member(target_household_id)
  then raise exception 'Household membership required'; end if;
  perform 1 from public.households where id = target_household_id for update;
  if not public.is_household_member(target_household_id)
  then raise exception 'Active household membership required'; end if;
  perform public.validate_chore_chart_payload(target_household_id, chart_payload);
  update public.proposed_charts set status = 'cancelled' where household_id = target_household_id and status = 'pending';
  insert into public.proposed_charts(household_id, created_by, status, payload, created_at)
    values (target_household_id, auth.uid(), 'pending', chart_payload, clock_timestamp()) returning id into new_chart_id;
  insert into public.proposed_chart_approvals(household_id, proposed_chart_id, member_id, approved)
    select target_household_id, new_chart_id, user_id, false from public.household_members
    where household_id = target_household_id and status = 'active';
  return new_chart_id;
end;
$$;

create or replace function public.approve_proposed_chart(target_chart_id uuid)
returns text language plpgsql security definer set search_path = public
as $$
declare target_household_id uuid; proposal public.proposed_charts%rowtype;
begin
  select household_id into target_household_id from public.proposed_charts where id = target_chart_id;
  if auth.uid() is null or not coalesce(public.is_household_member(target_household_id), false)
  then raise exception 'Pending household proposal not found'; end if;
  perform 1 from public.households where id = target_household_id for update;
  if not public.is_household_member(target_household_id)
  then raise exception 'Active household membership required'; end if;
  select * into proposal from public.proposed_charts where id = target_chart_id for update;
  if proposal.status = 'approved' then return 'approved'; end if;
  if proposal.status <> 'pending' then raise exception 'Pending household proposal not found'; end if;
  perform public.validate_chore_chart_payload(target_household_id, proposal.payload);
  update public.proposed_chart_approvals set approved = true, approved_at = now()
    where proposed_chart_id = target_chart_id and member_id = auth.uid();
  if not found then raise exception 'You are not an eligible voter for this proposal'; end if;
  if not exists (
    select 1 from public.household_members m
    left join public.proposed_chart_approvals a on a.proposed_chart_id = target_chart_id and a.member_id = m.user_id
    where m.household_id = target_household_id and m.status = 'active' and coalesce(a.approved, false) = false
  ) then
    update public.proposed_charts set status = 'approved' where id = target_chart_id;
    return 'approved';
  end if;
  return 'pending';
end;
$$;

create or replace function public.force_approve_proposed_chart(target_chart_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare target_household_id uuid; proposal public.proposed_charts%rowtype;
begin
  select household_id into target_household_id from public.proposed_charts where id = target_chart_id;
  if auth.uid() is null or not public.is_household_owner(target_household_id, auth.uid())
  then raise exception 'Only the active household owner can override approvals'; end if;
  perform 1 from public.households where id = target_household_id for update;
  if not public.is_household_member(target_household_id)
  then raise exception 'Active household membership required'; end if;
  select * into proposal from public.proposed_charts where id = target_chart_id for update;
  if not public.is_household_owner(target_household_id, auth.uid())
  then raise exception 'Only the active household owner can override approvals'; end if;
  if proposal.status = 'approved' then return; end if;
  if proposal.status <> 'pending' then raise exception 'Pending household proposal not found'; end if;
  perform public.validate_chore_chart_payload(target_household_id, proposal.payload);
  update public.proposed_chart_approvals set approved = true, approved_at = now() where proposed_chart_id = target_chart_id;
  update public.proposed_charts set status = 'approved' where id = target_chart_id;
end;
$$;

create or replace function public.cancel_proposed_charts(target_household_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_household_member(target_household_id)
  then raise exception 'Household membership required'; end if;
  perform 1 from public.households where id = target_household_id for update;
  if not public.is_household_member(target_household_id)
  then raise exception 'Active household membership required'; end if;
  update public.proposed_charts set status = 'cancelled' where household_id = target_household_id and status = 'pending';
end;
$$;

-- The client supplies date/occurrence expansion, while the database validates
-- against the approved immutable plan and commits all normalized rows at once.
create or replace function public.apply_approved_chore_chart(target_chart_id uuid, chore_rows jsonb)
returns void language plpgsql security definer set search_path = public
as $$
declare
  target_household_id uuid;
  proposal public.proposed_charts%rowtype;
  candidate public.chores%rowtype;
  previous public.chores%rowtype;
  task jsonb;
  expected_member text;
  expected_participants text[];
  actual_participants text[];
  task_ids text[];
  represented_task_ids text[] := '{}';
  row_ids text[] := '{}';
  cutover date;
  protected_series_ids text[] := '{}';
  expected_exclusions text[];
  actual_exclusions text[];
begin
  select household_id into target_household_id from public.proposed_charts where id = target_chart_id;
  if auth.uid() is null or not coalesce(public.is_household_member(target_household_id), false)
  then raise exception 'Approved household proposal not found'; end if;
  perform 1 from public.households where id = target_household_id for update;
  if not public.is_household_member(target_household_id)
  then raise exception 'Active household membership required'; end if;
  select * into proposal from public.proposed_charts where id = target_chart_id for update;
  if proposal.status <> 'approved' then raise exception 'Chart approval is required before applying chores'; end if;
  if proposal.applied_at is not null then return; end if;
  if exists (select 1 from public.proposed_charts where household_id = target_household_id and status = 'approved'
    and (created_at, id) > (proposal.created_at, proposal.id))
  then raise exception 'A newer approved chart supersedes this proposal'; end if;
  perform public.validate_chore_chart_payload(target_household_id, proposal.payload);
  if jsonb_typeof(chore_rows) is distinct from 'array' or jsonb_array_length(chore_rows) > 10000
  then raise exception 'Invalid chart chore rows'; end if;
  select ((clock_timestamp() at time zone h.timezone)::date + 1) into cutover
    from public.households h where h.id = target_household_id;
  select coalesce(array_agg(value ->> 'id'), '{}') into task_ids
    from jsonb_array_elements(proposal.payload -> 'generatedTasks');
  for candidate in select * from jsonb_populate_recordset(null::public.chores, chore_rows) loop
    if candidate.household_id is distinct from target_household_id or candidate.id is null
      or candidate.id = any(row_ids) or candidate.source_key is null or not (candidate.source_key = any(task_ids))
      or candidate.completed is distinct from false or candidate.completed_at is not null or candidate.completed_by_user_id is not null
    then raise exception 'Invalid or duplicate generated chore row'; end if;
    row_ids := array_append(row_ids, candidate.id);
    if not (candidate.source_key = any(represented_task_ids))
    then represented_task_ids := array_append(represented_task_ids, candidate.source_key); end if;
    select value into task from jsonb_array_elements(proposal.payload -> 'generatedTasks') where value ->> 'id' = candidate.source_key;
    select value ->> 'memberId' into expected_member from jsonb_array_elements(proposal.payload -> 'assignments')
      where (value -> 'taskIds') ? candidate.source_key;
    if candidate.assigned_to::text is distinct from expected_member
      or candidate.title is distinct from task ->> 'title'
      or candidate.recurring is distinct from task ->> 'frequency'
      or candidate.time_of_day is distinct from task ->> 'timeOfDay'
      or candidate.category is distinct from (case task ->> 'itemCategory'
        when 'living' then 'cleaning' when 'bedroom' then 'cleaning'
        when 'laundry' then 'laundry' when 'kitchen' then 'kitchen' when 'bathroom' then 'bathroom' else 'other' end)
      or candidate.points is distinct from (array[0, 5, 10, 15, 25, 30])[(task ->> 'difficulty')::int + 1]
    then raise exception 'Generated chore differs from approved task'; end if;
    select * into previous from public.chores where id = candidate.id for update;
    if found and (previous.household_id <> target_household_id or previous.completed
      or previous.source_key is distinct from candidate.source_key)
    then raise exception 'Chart cannot change history or manual chores'; end if;
    if previous.id is not null and previous.assignment_locked and (
      candidate.assigned_to is distinct from previous.assigned_to
      or candidate.assignment_mode is distinct from previous.assignment_mode
      or candidate.round_robin_participant_ids is distinct from previous.round_robin_participant_ids
      or candidate.round_robin_all_members is distinct from previous.round_robin_all_members
      or candidate.round_robin_cursor is distinct from previous.round_robin_cursor
      or candidate.due_date is distinct from previous.due_date
      or candidate.scheduled_date is distinct from previous.scheduled_date
      or candidate.recurrence_series_id is distinct from previous.recurrence_series_id
    ) then raise exception 'A manual assignment changed; rebuild the chart'; end if;
    if previous.id is not null and previous.assignment_locked then
      protected_series_ids := array_append(protected_series_ids, previous.recurrence_series_id);
    elsif candidate.materialization_starts_on is distinct from cutover
      or candidate.scheduled_date is null or candidate.scheduled_date < cutover
      or candidate.recurrence_series_id is null
    then raise exception 'New generated series must start at the future chart cutover'; end if;
    select coalesce(array_agg(value #>> '{}' order by value #>> '{}'), '{}') into expected_exclusions
      from jsonb_array_elements(coalesce(proposal.payload -> 'excludedAssignments' -> candidate.source_key, '[]'::jsonb));
    select coalesce(array_agg(member_id::text order by member_id::text), '{}') into actual_exclusions
      from unnest(candidate.excluded_participant_ids) member_id;
    if actual_exclusions is distinct from expected_exclusions
    then raise exception 'Generated chore exclusions differ from approved constraints'; end if;
    if proposal.payload -> 'pinnedAssignments' ? candidate.source_key then
      if coalesce(previous.assignment_locked, false) then
        if not candidate.assignment_locked then raise exception 'A manual assignment lock must be preserved'; end if;
      elsif candidate.assignment_mode <> 'specific-person' or candidate.assignment_locked then
        raise exception 'Generated preference pins use a specific person without a manual assignment lock';
      end if;
    else
      select coalesce(array_agg(user_id::text order by user_id::text), '{}') into expected_participants
        from public.household_members where household_id = target_household_id and status = 'active'
        and not coalesce((proposal.payload -> 'excludedAssignments' -> candidate.source_key) ? user_id::text, false);
      select coalesce(array_agg(member_id::text order by member_id::text), '{}') into actual_participants
        from unnest(candidate.round_robin_participant_ids) member_id;
      if candidate.assignment_mode <> 'round-robin' or candidate.assignment_locked
        or expected_participants is distinct from actual_participants
        or candidate.round_robin_cursor < 0 or candidate.round_robin_cursor >= cardinality(candidate.round_robin_participant_ids)
        or candidate.round_robin_participant_ids[candidate.round_robin_cursor + 1] is distinct from candidate.assigned_to
      then raise exception 'Generated chores must rotate among eligible members'; end if;
    end if;
    candidate.creator_id := coalesce(previous.creator_id, proposal.created_by);
    candidate.created_at := coalesce(previous.created_at, now());
    candidate.updated_at := now();
    insert into public.chores select candidate.*
    on conflict (id) do update set
      title = excluded.title, description = excluded.description, assigned_to = excluded.assigned_to,
      assignment_mode = excluded.assignment_mode, round_robin_participant_ids = excluded.round_robin_participant_ids,
      round_robin_all_members = excluded.round_robin_all_members, round_robin_cursor = excluded.round_robin_cursor,
      excluded_participant_ids = excluded.excluded_participant_ids,
      due_date = excluded.due_date, initial_due_date = excluded.initial_due_date, next_due_date = excluded.next_due_date,
      scheduled_date = excluded.scheduled_date, initial_scheduled_date = excluded.initial_scheduled_date,
      monthly_anchor_day = excluded.monthly_anchor_day, excluded_occurrence_dates = excluded.excluded_occurrence_dates,
      materialization_starts_on = excluded.materialization_starts_on, recurrence_ends_on = excluded.recurrence_ends_on,
      points = excluded.points, category = excluded.category, recurring = excluded.recurring,
      recurrence_series_id = excluded.recurrence_series_id, occurrence_index = excluded.occurrence_index,
      next_occurrence_id = excluded.next_occurrence_id, time_of_day = excluded.time_of_day,
      assignment_locked = excluded.assignment_locked, updated_at = excluded.updated_at;
  end loop;
  if cardinality(represented_task_ids) <> cardinality(task_ids) or cardinality(row_ids) <> cardinality(task_ids)
  then raise exception 'Every approved task needs an unfinished chore occurrence'; end if;
  -- A manual lock protects the entire existing series, even when a different
  -- locked occurrence was selected as its anchor by another device.
  select coalesce(array_agg(distinct recurrence_series_id), '{}') into protected_series_ids
    from public.chores where household_id = target_household_id and assignment_locked and not completed
    and recurrence_series_id is not null
    and (recurrence_ends_on is null or recurrence_ends_on > cutover - 1);
  insert into public.retired_chore_series(household_id, recurrence_series_id, ends_before, retired_by_chart_id)
    select target_household_id, recurrence_series_id, least(min(recurrence_ends_on), cutover), target_chart_id
      from public.chores where household_id = target_household_id and source_key is not null
      and recurrence_series_id is not null
      and (not assignment_locked or recurrence_ends_on <= cutover - 1) and not (id = any(row_ids))
      and not (recurrence_series_id = any(protected_series_ids))
      group by recurrence_series_id
    on conflict (household_id, recurrence_series_id) do update
      set ends_before = least(public.retired_chore_series.ends_before, excluded.ends_before),
        retired_by_chart_id = excluded.retired_by_chart_id;
  -- Recurrence ends are exclusive. Today's existing occurrences and all
  -- completed facts remain; only future unfinished replaced rows are removed.
  delete from public.chores where household_id = target_household_id and source_key is not null
    and not completed and (not assignment_locked or recurrence_ends_on <= cutover - 1) and scheduled_date >= cutover
    and not (id = any(row_ids))
    and not coalesce(recurrence_series_id = any(protected_series_ids), false);
  update public.chores set recurrence_ends_on = least(coalesce(recurrence_ends_on, cutover), cutover), updated_at = now()
    where household_id = target_household_id and source_key is not null
    and (not assignment_locked or recurrence_ends_on <= cutover - 1) and not (id = any(row_ids))
    and not coalesce(recurrence_series_id = any(protected_series_ids), false);
  update public.proposed_charts set applied_at = clock_timestamp() where id = target_chart_id;
end;
$$;

revoke all on function public.replace_proposed_chart(uuid, jsonb), public.approve_proposed_chart(uuid),
  public.force_approve_proposed_chart(uuid), public.cancel_proposed_charts(uuid), public.apply_approved_chore_chart(uuid, jsonb)
  from public, anon;
grant execute on function public.replace_proposed_chart(uuid, jsonb), public.approve_proposed_chart(uuid),
  public.force_approve_proposed_chart(uuid), public.cancel_proposed_charts(uuid), public.apply_approved_chore_chart(uuid, jsonb)
  to authenticated;
