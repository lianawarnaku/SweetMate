-- Submit a revision and optionally approve only the caller, as one transaction.
create or replace function public.submit_chore_chart_review(
  target_household_id uuid, chart_payload jsonb,
  expected_chart_id uuid, approve_self boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare latest_chart_id uuid; new_chart_id uuid;
begin
  if auth.uid() is null or not public.is_household_member(target_household_id)
  then raise exception 'Active household membership required'; end if;
  perform 1 from public.households where id = target_household_id for update;
  if not public.is_household_member(target_household_id)
  then raise exception 'Active household membership required'; end if;
  select id into latest_chart_id from public.proposed_charts
    where household_id = target_household_id and status in ('pending', 'approved')
    order by created_at desc, id desc limit 1;
  if latest_chart_id is distinct from expected_chart_id
  then raise exception 'This chart has changed. Review the latest version before submitting your revision.'; end if;
  new_chart_id := public.replace_proposed_chart(target_household_id, chart_payload);
  if coalesce(approve_self, false) then
    perform public.approve_proposed_chart(new_chart_id);
  end if;
  return new_chart_id;
end;
$$;
revoke all on function public.submit_chore_chart_review(uuid, jsonb, uuid, boolean) from public, anon;
grant execute on function public.submit_chore_chart_review(uuid, jsonb, uuid, boolean) to authenticated;
notify pgrst, 'reload schema';
