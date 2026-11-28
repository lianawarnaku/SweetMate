-- An old approved chart must not report a successful vote or activate while a
-- restarted/revised review is pending. Historical rows and votes remain intact.
begin;
create or replace function public.assert_current_chore_chart(target_chart_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare target_household_id uuid; latest_chart_id uuid;
begin
  select household_id into target_household_id from public.proposed_charts where id=target_chart_id;
  select id into latest_chart_id from public.proposed_charts
    where household_id=target_household_id and status in ('pending','approved')
    order by created_at desc,id desc limit 1;
  if latest_chart_id is distinct from target_chart_id then
    raise exception 'This chart has changed. Review the latest version before approving or applying it.';
  end if;
end;
$$;
revoke all on function public.assert_current_chore_chart(uuid) from public,anon,authenticated;

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
  perform public.assert_current_chore_chart(target_chart_id);
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
  perform public.assert_current_chore_chart(target_chart_id);
  if not public.is_household_owner(target_household_id, auth.uid())
  then raise exception 'Only the active household owner can override approvals'; end if;
  if proposal.status = 'approved' then return; end if;
  if proposal.status <> 'pending' then raise exception 'Pending household proposal not found'; end if;
  perform public.validate_chore_chart_payload(target_household_id, proposal.payload);
  update public.proposed_chart_approvals set approved = true, approved_at = now() where proposed_chart_id = target_chart_id;
  update public.proposed_charts set status = 'approved' where id = target_chart_id;
end;
$$;

-- The apply RPC writes chores and applied_at in one transaction. Rejecting
-- its final stamp rolls back every generated row if the review is superseded.
create or replace function public.guard_current_chart_activation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.applied_at is null and new.applied_at is not null then
    perform public.assert_current_chore_chart(new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.guard_current_chart_activation() from public,anon,authenticated;
drop trigger if exists current_chart_activation on public.proposed_charts;
create trigger current_chart_activation before update of applied_at on public.proposed_charts
  for each row execute function public.guard_current_chart_activation();
notify pgrst,'reload schema';
commit;
