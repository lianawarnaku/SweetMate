begin;

-- Other is a saved choice; the app uses apartment planning defaults.
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
    or coalesce(home_profile->>'housingType', '') not in ('traditional', 'suite', 'apartment', 'other')
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

notify pgrst, 'reload schema';
commit;
