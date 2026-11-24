-- Read the latest review and all active votes in one consistent snapshot.
create or replace function public.get_household_chart_completion(target_household_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  latest_chart public.proposed_charts%rowtype;
  member_count integer;
  approved_count integer;
begin
  if auth.uid() is null or not public.is_household_member(target_household_id)
  then raise exception 'Active household membership required'; end if;
  select * into latest_chart from public.proposed_charts
    where household_id = target_household_id and status in ('pending', 'approved')
    order by created_at desc, id desc limit 1;
  select count(*), count(*) filter (where a.approved) into member_count, approved_count
    from public.household_members m
    left join public.proposed_chart_approvals a
      on a.proposed_chart_id = latest_chart.id and a.member_id = m.user_id
    where m.household_id = target_household_id and m.status = 'active';
  return jsonb_build_object(
    'chartId', latest_chart.id, 'status', latest_chart.status, 'appliedAt', latest_chart.applied_at,
    'memberCount', member_count, 'approvedCount', approved_count,
    'complete', coalesce(latest_chart.status = 'approved' and latest_chart.applied_at is not null
      and member_count > 0 and approved_count = member_count, false)
  );
end;
$$;
revoke all on function public.get_household_chart_completion(uuid) from public, anon;
grant execute on function public.get_household_chart_completion(uuid) to authenticated;
notify pgrst, 'reload schema';
