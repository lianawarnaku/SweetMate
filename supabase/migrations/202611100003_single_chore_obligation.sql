-- An identity describes the work, independent of cadence and assignment.
-- Never infer identity from a title: bedrooms/bathrooms can share names.
-- Roll out this migration before the matching mobile build.
begin;
lock table public.chores in share row exclusive mode;
alter table public.chores
  add column if not exists chore_definition_id text,
  add column if not exists chore_definition jsonb,
  add column if not exists skipped_at timestamptz,
  add column if not exists skipped_reason text check (skipped_reason in ('outstanding','schedule-replaced'));

with recursive lineage as (
  select c.id as origin,c.id,c.household_id,c.recurrence_series_id,array[c.id] as visited,0 as depth
  from public.chores c where c.recurring is not null and c.recurrence_series_id is null
  union all
  select l.origin,p.id,p.household_id,p.recurrence_series_id,l.visited || p.id,l.depth+1
  from lineage l join public.chores p on p.household_id=l.household_id and p.next_occurrence_id=l.id
  where not p.id=any(l.visited) and l.depth<10000
), roots as (
  select distinct on(origin) origin,coalesce(recurrence_series_id,id) as series from lineage order by origin,depth desc,id
)
update public.chores c set recurrence_series_id=roots.series from roots where c.id=roots.origin;

update public.chores set chore_definition_id = coalesce(chore_definition_id,
  case when source_key is not null then 'source:' || source_key
       else 'series:' || coalesce(recurrence_series_id,id) end);

-- Choose the oldest actual row in each series, then the most recently
-- created series' configuration. Completed history is not rewritten.
with roots as (
  select distinct on (household_id, chore_definition_id, coalesce(recurrence_series_id,id)) *
  from public.chores
  order by household_id,chore_definition_id,coalesce(recurrence_series_id,id),coalesce(scheduled_date,(due_date at time zone (select timezone from public.households h where h.id=household_id))::date),id
), canonical as (
  select distinct on (household_id,chore_definition_id) * from roots
  order by household_id,chore_definition_id,created_at desc,id
), configs as (
  select household_id,chore_definition_id,jsonb_strip_nulls(jsonb_build_object(
    'id',chore_definition_id,'seriesId',coalesce(c.recurrence_series_id,c.id),
    'title',title,'description',description,'category',category,'points',points,
    'recurring',recurring,'assignmentMode',assignment_mode,'assignedTo',coalesce(assigned_to::text,''),
    'roundRobinParticipantIds',round_robin_participant_ids,'roundRobinAllMembers',round_robin_all_members,
    'excludedParticipantIds',excluded_participant_ids,'timeOfDay',time_of_day,
    'anchorDate',coalesce(initial_scheduled_date,scheduled_date,(coalesce(initial_due_date,due_date) at time zone h.timezone)::date),
    'anchorDueDate',coalesce(initial_due_date,due_date),'monthlyAnchorDay',coalesce(monthly_anchor_day,extract(day from due_date at time zone h.timezone)::int),
    'updatedAt',to_char(c.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )) as config
  from canonical c join public.households h on h.id=c.household_id
)
update public.chores c set chore_definition=configs.config
from configs where c.household_id=configs.household_id and c.chore_definition_id=configs.chore_definition_id
  and c.chore_definition is null;

with ranked as (
  select id,row_number() over(partition by household_id,chore_definition_id order by coalesce(scheduled_date,(due_date at time zone (select timezone from public.households h where h.id=household_id))::date),created_at,id) as ordinal
  from public.chores where not completed and skipped_at is null
)
update public.chores c set skipped_at=now(),
  skipped_reason=case when coalesce(c.scheduled_date,(c.due_date at time zone h.timezone)::date) > (now() at time zone h.timezone)::date then 'schedule-replaced' else 'outstanding' end,
  updated_at=now()
from ranked r,public.households h where c.id=r.id and r.ordinal>1 and h.id=c.household_id;

update public.chores c set assigned_to=null,assignment_mode='unassigned',updated_at=now()
where not completed and skipped_at is null and assigned_to is not null and not exists (
  select 1 from public.household_members m where m.household_id=c.household_id and m.user_id=c.assigned_to and m.status='active'
);

create index if not exists chores_definition_idx on public.chores(household_id,chore_definition_id);
create unique index if not exists chores_one_outstanding_definition on public.chores(household_id,chore_definition_id)
  where not completed and skipped_at is null;

-- A legacy binary can read the household, but cannot mutate chore debt or
-- publish chore points using its obsolete completion/materialization rules.
-- This is a client-compatibility signal; household membership/RLS still
-- provides authorization. Privileged maintenance sessions have auth.uid=null.
create or replace function public.require_current_chore_policy()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is not null and coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-sweetmate-chore-policy','') <> 'single-obligation-v1' then
    raise exception 'Update SweetMate to the latest TestFlight build before changing chores.' using errcode='0A000';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.require_current_chore_policy() from public,anon,authenticated;
create trigger aa_require_current_chore_policy before insert or update or delete on public.chores
  for each row execute function public.require_current_chore_policy();

create or replace function public.guard_legacy_chore_scores()
returns trigger language plpgsql security definer set search_path=public as $$
declare old_state jsonb;
begin
  if auth.uid() is null or coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-sweetmate-chore-policy','')='single-obligation-v1' then return new; end if;
  old_state:=case when tg_op='UPDATE' then old.state else '{}'::jsonb end;
  if (new.state ? 'chores' and new.state->'chores' is distinct from old_state->'chores') or exists (
    select 1 from jsonb_array_elements(coalesce(new.state->'roommates','[]'::jsonb)) n
    left join jsonb_array_elements(coalesce(old_state->'roommates','[]'::jsonb)) o on o->>'id'=n->>'id'
    where (o is not null and (n->'points' is distinct from o->'points' or n->'weeklyPoints' is distinct from o->'weeklyPoints'))
      or (o is null and (coalesce(n->>'points','0')<>'0' or coalesce(n->>'weeklyPoints','0')<>'0'))
  ) then raise exception 'Update SweetMate to the latest TestFlight build before changing chore scores.' using errcode='0A000'; end if;
  return new;
end $$;
revoke all on function public.guard_legacy_chore_scores() from public,anon,authenticated;
create trigger aa_guard_legacy_chore_scores before insert or update on public.household_states
  for each row execute function public.guard_legacy_chore_scores();

-- Serialize competing materializers/undo operations across devices. A new
-- turn never takes the outstanding chore away from its original owner.
create or replace function public.enforce_single_chore_obligation()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  other public.chores%rowtype;
  config jsonb;
  zone text;
  next_day date;
begin
  new.chore_definition_id := coalesce(new.chore_definition_id,
    case when new.source_key is not null then 'source:' || new.source_key else 'series:' || coalesce(new.recurrence_series_id,new.id) end);
  perform pg_advisory_xact_lock(hashtextextended(new.household_id::text || ':' || new.chore_definition_id,0));
  select timezone into zone from public.households where id=new.household_id;
  next_day := coalesce(new.scheduled_date,(new.due_date at time zone zone)::date);
  select c.chore_definition into config from public.chores c
    where c.household_id=new.household_id and c.chore_definition_id=new.chore_definition_id and c.id<>new.id and c.chore_definition is not null
    order by c.chore_definition->>'updatedAt' desc,c.chore_definition->>'seriesId' limit 1;
  if config is not null and (new.chore_definition is null or config->>'updatedAt' > new.chore_definition->>'updatedAt') then new.chore_definition:=config; end if;
  if new.chore_definition is not null and new.chore_definition->>'id' is distinct from new.chore_definition_id then
    raise exception 'Shared chore identity does not match its definition';
  end if;
  -- Skipped missed turns are permanent, including on old clients.
  if tg_op='UPDATE' and old.skipped_reason='outstanding' then
    new.skipped_at:=old.skipped_at; new.skipped_reason:=old.skipped_reason;
    new.completed:=false; new.completed_at:=null; new.completed_by_user_id:=null;
  end if;
  if new.completed or new.skipped_at is not null then return new; end if;
  if new.chore_definition->>'endsOn' is not null and next_day >= (new.chore_definition->>'endsOn')::date then
    new.skipped_at:=now(); new.skipped_reason:='outstanding'; new.updated_at:=now(); return new;
  end if;
  if (tg_op='INSERT' or old.skipped_reason='schedule-replaced') and exists (
    select 1 from public.chores c where c.household_id=new.household_id and c.chore_definition_id=new.chore_definition_id
      and c.id<>new.id and c.completed and c.completed_at is not null and (c.completed_at at time zone zone)::date >= next_day
  ) then
    new.skipped_at:=now(); new.skipped_reason:='outstanding'; new.updated_at:=now(); return new;
  end if;
  if new.assigned_to is not null and not exists(select 1 from public.household_members where household_id=new.household_id and user_id=new.assigned_to and status='active') then
    new.assigned_to:=null; new.assignment_mode:='unassigned';
  end if;
  select * into other from public.chores c
    where c.household_id=new.household_id and c.chore_definition_id=new.chore_definition_id and c.id<>new.id and not c.completed and c.skipped_at is null
    order by coalesce(c.scheduled_date,(c.due_date at time zone zone)::date),c.created_at,c.id limit 1;
  if found then
    if (next_day,new.created_at,new.id) < (coalesce(other.scheduled_date,(other.due_date at time zone zone)::date),other.created_at,other.id) then
      update public.chores set skipped_at=now(),skipped_reason=case when coalesce(scheduled_date,(due_date at time zone zone)::date) > (now() at time zone zone)::date then 'schedule-replaced' else 'outstanding' end,updated_at=now()
        where id=other.id;
    else
      new.skipped_at:=now(); new.skipped_reason:=case when next_day > (now() at time zone zone)::date then 'schedule-replaced' else 'outstanding' end;
      new.updated_at:=now();
    end if;
  end if;
  return new;
end $$;
create trigger enforce_single_chore_obligation before insert or update on public.chores
  for each row execute function public.enforce_single_chore_obligation();

-- Covers voluntary departures and host removals on every device, not only
-- the client that performed the membership change.
create or replace function public.return_departed_member_chores()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' or (old.status='active' and new.status<>'active') then
    update public.chores set assigned_to=null,assignment_mode='unassigned',updated_at=now()
      where household_id=old.household_id and assigned_to=old.user_id and not completed and skipped_at is null;
  end if;
  return null;
end $$;
create trigger return_departed_member_chores after update of status or delete on public.household_members
  for each row execute function public.return_departed_member_chores();
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
      assignment_locked = excluded.assignment_locked, chore_definition_id = excluded.chore_definition_id,
      chore_definition = excluded.chore_definition, updated_at = excluded.updated_at;
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
commit;
