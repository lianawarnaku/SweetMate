-- Active members can edit setup-generated chores without replacing shared records.
create or replace function public.update_generated_task_settings(
  target_household_id uuid, task_id text, task_settings jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  profile jsonb;
  chore_title text;
  chore_difficulty integer;
  chore_frequency text;
begin
  perform 1 from public.households where id = target_household_id for update;
  if not found or not exists (
    select 1 from public.household_members
    where household_id = target_household_id and user_id = auth.uid() and status = 'active'
  ) then raise exception 'An active household membership is required.'; end if;
  if task_id is null or length(task_id) = 0 or length(task_id) > 512
    or task_settings is null or jsonb_typeof(task_settings) <> 'object'
    or jsonb_typeof(task_settings->'title') is distinct from 'string'
    or jsonb_typeof(task_settings->'difficulty') is distinct from 'number'
    or coalesce(task_settings->>'difficulty', '') not in ('1', '2', '3', '4', '5')
    or coalesce(task_settings->>'frequency', '') not in ('daily', 'everyOtherDay', 'everyThreeDays', 'weekly', 'biweekly', 'monthly')
  then raise exception 'Choose a chore name, difficulty from 1 to 5, and supported frequency.'; end if;
  chore_title := btrim(task_settings->>'title');
  if length(chore_title) = 0 or length(chore_title) > 120
  then raise exception 'Use a chore name between 1 and 120 characters.'; end if;
  chore_difficulty := (task_settings->>'difficulty')::integer;
  chore_frequency := task_settings->>'frequency';
  select state->'homeProfile' into profile from public.household_states
    where household_key = target_household_id::text for update;
  if profile is null or jsonb_typeof(profile) <> 'object'
  then raise exception 'Finish your home details before editing generated tasks.'; end if;
  profile := jsonb_set(profile, '{generatedTaskOverrides}',
    coalesce(profile->'generatedTaskOverrides', '{}'::jsonb) || jsonb_build_object(
      task_id, jsonb_build_object('title', chore_title, 'difficulty', chore_difficulty)
    ), true);
  profile := jsonb_set(profile, '{recurrenceOverrides}',
    coalesce(profile->'recurrenceOverrides', '{}'::jsonb) || jsonb_build_object(task_id, chore_frequency), true);
  update public.household_states set
    state = jsonb_set(state, '{homeProfile}', profile, true), updated_by = auth.uid(), updated_at = now()
    where household_key = target_household_id::text;
  return profile;
end;
$$;
revoke all on function public.update_generated_task_settings(uuid, text, jsonb) from public, anon;
grant execute on function public.update_generated_task_settings(uuid, text, jsonb) to authenticated;
notify pgrst, 'reload schema';
