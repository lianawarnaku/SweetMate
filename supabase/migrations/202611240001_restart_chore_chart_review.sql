-- Restart review without mutating the applied chart or its chore history.
begin;

create or replace function public.restart_chore_chart_review(target_household_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  previous_chart public.proposed_charts%rowtype;
  new_chart_id uuid;
begin
  if auth.uid() is null or not public.is_household_member(target_household_id)
  then raise exception 'Active household membership required'; end if;
  perform 1 from public.households where id = target_household_id for update;
  if not public.is_household_member(target_household_id)
  then raise exception 'Active household membership required'; end if;

  select * into previous_chart from public.proposed_charts
    where household_id = target_household_id and status in ('pending', 'approved')
    order by created_at desc, id desc limit 1;
  if not found then return null; end if;

  update public.proposed_charts set status = 'cancelled'
    where household_id = target_household_id and status = 'pending';
  -- Keep the saved rules as an editable draft, including older plans that
  -- need a rebuild for the current roster. Approval still validates the entire
  -- payload; merely restarting must not apply chores or erase saved settings.
  insert into public.proposed_charts(household_id, created_by, status, payload, created_at)
    values (target_household_id, auth.uid(), 'pending', previous_chart.payload, clock_timestamp())
    returning id into new_chart_id;
  insert into public.proposed_chart_approvals(household_id, proposed_chart_id, member_id, approved)
    select target_household_id, new_chart_id, user_id, false
    from public.household_members
    where household_id = target_household_id and status = 'active';
  return new_chart_id;
end;
$$;
revoke all on function public.restart_chore_chart_review(uuid) from public, anon;
grant execute on function public.restart_chore_chart_review(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
