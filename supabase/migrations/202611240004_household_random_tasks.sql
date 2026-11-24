begin;
create extension if not exists pg_cron with schema pg_catalog;

create table public.household_random_tasks (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 120),
  mode text not null check (mode in ('up-for-grabs', 'random')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  claim_deadline timestamptz,
  assigned_at timestamptz,
  assignment_kind text check (assignment_kind in ('claimed', 'random')),
  chore_id text unique references public.chores(id) on delete cascade,
  check ((mode = 'up-for-grabs') = (claim_deadline is not null)),
  check ((assigned_at is null and assignment_kind is null and chore_id is null)
    or (assigned_at is not null and assignment_kind is not null and chore_id is not null))
);
create index household_random_tasks_expiring on public.household_random_tasks(claim_deadline)
  where assigned_at is null;
create index household_random_tasks_household on public.household_random_tasks(household_id, created_at desc);
alter table public.household_random_tasks enable row level security;
create policy "members view random tasks" on public.household_random_tasks for select to authenticated
  using (public.is_household_member(household_id));
revoke all on public.household_random_tasks from public, anon, authenticated;
grant select on public.household_random_tasks to authenticated;
create trigger aa_sanitize_deleted_members before insert or update on public.household_random_tasks
  for each row execute function public.sanitize_deleted_member_write();
alter publication supabase_realtime add table public.household_random_tasks;

-- Called only by the authenticated entry points below or by the scheduler.
-- The row lock serializes a claim against another claim or the deadline draw.
create function public.assign_household_random_task(task_id uuid, claimant_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare task public.household_random_tasks%rowtype; winner uuid; stamp timestamptz; due_stamp timestamptz; zone text; new_chore_id text;
begin
  select * into task from public.household_random_tasks where id = task_id for update;
  if not found then raise exception 'This random task no longer exists.'; end if;
  if task.assigned_at is not null then return task.id; end if;
  if claimant_id is null then
    select user_id into winner from public.household_members
      where household_id = task.household_id and status = 'active'
      order by random() limit 1 for share;
  else
    select user_id into winner from public.household_members
      where household_id = task.household_id and user_id = claimant_id and status = 'active' for share;
  end if;
  -- An empty household stays available for the next active member; never
  -- assign to someone who has left or create an unowned chore silently.
  if winner is null then return task.id; end if;
  stamp := clock_timestamp();
  due_stamp := stamp + interval '24 hours';
  select timezone into zone from public.households where id = task.household_id;
  new_chore_id := 'random-task:' || task.id::text;
  insert into public.chores(id, household_id, title, creator_id, assigned_to, assignment_mode,
    due_date, initial_due_date, scheduled_date, initial_scheduled_date,
    category, points, source_key, assignment_locked, created_at, updated_at)
  values (new_chore_id, task.household_id, task.title, task.created_by, winner, 'specific-person',
    due_stamp, due_stamp, (due_stamp at time zone zone)::date, (due_stamp at time zone zone)::date,
    'other', 0, new_chore_id, true, stamp, stamp);
  update public.household_random_tasks set assigned_at = stamp,
    assignment_kind = case when claimant_id is null then 'random' else 'claimed' end,
    chore_id = new_chore_id where id = task.id;
  return task.id;
end;
$$;
revoke all on function public.assign_household_random_task(uuid, uuid) from public, anon, authenticated;

create function public.resolve_expired_random_tasks(target_household_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare task record;
begin
  for task in select id from public.household_random_tasks
    where assigned_at is null and claim_deadline <= clock_timestamp()
      and (target_household_id is null or household_id = target_household_id)
    order by claim_deadline, id for update skip locked
  loop perform public.assign_household_random_task(task.id); end loop;
end;
$$;
revoke all on function public.resolve_expired_random_tasks(uuid) from public, anon, authenticated;

create function public.create_household_random_task(target_household_id uuid, task_id uuid, task_title text, task_mode text)
returns uuid language plpgsql security definer set search_path = public as $$
declare existing public.household_random_tasks%rowtype; stamp timestamptz := clock_timestamp();
begin
  if auth.uid() is null or not public.is_household_member(target_household_id)
    then raise exception 'Active household membership required'; end if;
  if task_id is null or task_title is null or length(btrim(task_title)) not between 1 and 120
    then raise exception 'Enter a task name with 1 to 120 characters.'; end if;
  if task_mode is null or task_mode not in ('up-for-grabs', 'random') then raise exception 'Choose how to assign this task.'; end if;
  -- A retried request uses the same ID and must not create a second draw.
  perform pg_advisory_xact_lock(hashtextextended('random-task:' || task_id::text, 0));
  select * into existing from public.household_random_tasks where id = task_id;
  if found then
    if existing.household_id <> target_household_id or existing.created_by is distinct from auth.uid()
      or existing.title <> btrim(task_title) or existing.mode <> task_mode then raise exception 'This task ID is already in use.'; end if;
    return existing.id;
  end if;
  insert into public.household_random_tasks(id, household_id, title, mode, created_by, created_at, claim_deadline)
    values(task_id, target_household_id, btrim(task_title), task_mode, auth.uid(), stamp,
      case when task_mode = 'up-for-grabs' then stamp + interval '24 hours' end);
  if task_mode = 'random' then perform public.assign_household_random_task(task_id); end if;
  return task_id;
end;
$$;
revoke all on function public.create_household_random_task(uuid, uuid, text, text) from public, anon;
grant execute on function public.create_household_random_task(uuid, uuid, text, text) to authenticated;

create function public.claim_household_random_task(target_household_id uuid, task_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare task public.household_random_tasks%rowtype;
begin
  if auth.uid() is null or not public.is_household_member(target_household_id)
    then raise exception 'Active household membership required'; end if;
  select * into task from public.household_random_tasks where id = task_id and household_id = target_household_id for update;
  if not found then raise exception 'This random task no longer exists.'; end if;
  if task.assigned_at is not null then
    if task.assignment_kind = 'claimed' and exists(select 1 from public.chores where id = task.chore_id and assigned_to = auth.uid()) then return task.id; end if;
    raise exception 'This task has already been claimed or assigned.';
  end if;
  if task.mode <> 'up-for-grabs' then raise exception 'This task is being randomly assigned.'; end if;
  if task.claim_deadline <= clock_timestamp() then
    -- A late click cannot beat the cutoff even if the scheduler has not run.
    return public.assign_household_random_task(task.id);
  end if;
  return public.assign_household_random_task(task.id, auth.uid());
end;
$$;
revoke all on function public.claim_household_random_task(uuid, uuid) from public, anon;
grant execute on function public.claim_household_random_task(uuid, uuid) to authenticated;

create function public.get_household_random_tasks(target_household_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_household_member(target_household_id)
    then raise exception 'Active household membership required'; end if;
  perform public.resolve_expired_random_tasks(target_household_id);
  return (select jsonb_build_object('householdId', target_household_id, 'serverNow', clock_timestamp(),
    'tasks', coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object('title', coalesce(c.title, t.title),
      'assigned_to', c.assigned_to, 'completed', coalesce(c.completed, false), 'due_at', c.due_date)
      order by t.created_at desc, t.id), '[]'::jsonb),
    'chores', coalesce(jsonb_agg(to_jsonb(c)) filter (where c.id is not null), '[]'::jsonb))
    from public.household_random_tasks t left join public.chores c on c.id = t.chore_id and c.household_id = t.household_id
    where t.household_id = target_household_id and c.skipped_at is null
      and (not coalesce(c.completed, false) or c.completed_at > now() - interval '7 days'));
end;
$$;
revoke all on function public.get_household_random_tasks(uuid) from public, anon;
grant execute on function public.get_household_random_tasks(uuid) to authenticated;

-- Runs even when nobody has the app open. Claiming closes at the exact
-- server deadline; the background draw runs on the next minute tick.
select cron.schedule('household-random-task-expiry', '* * * * *', 'select public.resolve_expired_random_tasks()');
notify pgrst, 'reload schema';
commit;
