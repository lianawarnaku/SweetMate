-- Complete an existing household without replacing any of its shared records.
create or replace function public.finish_household_setup(target_household_id uuid, home_profile jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.households where id = target_household_id for update;
  if not found or not exists (
    select 1 from public.household_members
    where household_id = target_household_id and user_id = auth.uid() and status = 'active'
  ) then raise exception 'An active household membership is required.'; end if;
  if home_profile is null or jsonb_typeof(home_profile) <> 'object'
    or coalesce(home_profile->>'housingType', '') not in ('traditional', 'suite', 'apartment')
    or jsonb_typeof(home_profile->'items') is distinct from 'array'
    or jsonb_typeof(home_profile->'additionalChores') is distinct from 'array'
  then raise exception 'Finish your home details before completing household setup.'; end if;
  insert into public.household_states(household_key, household_id, state, updated_by, updated_at)
  values(target_household_id::text, target_household_id, jsonb_build_object('homeProfile', home_profile), auth.uid(), now())
  on conflict (household_key) do update set
    state = jsonb_set(public.household_states.state, '{homeProfile}', excluded.state->'homeProfile', true),
    updated_by = auth.uid(), updated_at = now();
  insert into public.household_preferences(household_id, household_complete, updated_by, updated_at)
  values(target_household_id, true, auth.uid(), now())
  on conflict (household_id) do update set household_complete = true, updated_by = auth.uid(), updated_at = now();
end;
$$;
revoke all on function public.finish_household_setup(uuid, jsonb) from public, anon;
grant execute on function public.finish_household_setup(uuid, jsonb) to authenticated;

-- Completion is monotonic for a household. Old clients used to echo cached
-- false values back on load; a stale client must not relock a completed home.
create or replace function public.preserve_household_setup_completion()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.household_complete then new.household_complete := true; end if;
  return new;
end;
$$;
drop trigger if exists preserve_household_setup_completion on public.household_preferences;
create trigger preserve_household_setup_completion before update on public.household_preferences
for each row execute function public.preserve_household_setup_completion();

-- A pre-recovery client can still write a snapshot with a missing homeProfile.
-- Keep the saved profile while allowing every other field in that write through.
create or replace function public.preserve_saved_home_profile()
returns trigger language plpgsql set search_path = public as $$
begin
  if jsonb_typeof(old.state->'homeProfile') = 'object'
    and (new.state->'homeProfile' is null or new.state->'homeProfile' = 'null'::jsonb)
  then new.state := jsonb_set(new.state, '{homeProfile}', old.state->'homeProfile', true); end if;
  return new;
end;
$$;
drop trigger if exists preserve_saved_home_profile on public.household_states;
create trigger preserve_saved_home_profile before update on public.household_states
for each row execute function public.preserve_saved_home_profile();
notify pgrst, 'reload schema';
