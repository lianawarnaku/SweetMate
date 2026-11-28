-- CURRENT_ROLE is a PostgreSQL special expression. The old variable of that
-- name was read as the database role instead of the member's household role.
begin;
create or replace function public.leave_household(target_household_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare member_role text; active_member_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_household_member(target_household_id) then raise exception 'Active membership required'; end if;
  -- Serialize departures before testing whether the owner is the last member.
  perform 1 from public.households where id=target_household_id for update;
  select m.role into member_role from public.household_members m
    where m.household_id=target_household_id and m.user_id=auth.uid() and m.status='active';
  if member_role is null then raise exception 'Active membership required'; end if;
  select count(*) into active_member_count from public.household_members m
    where m.household_id=target_household_id and m.status='active';
  if member_role='owner' and active_member_count>1 then
    raise exception 'Transfer ownership or remove the other members before leaving';
  end if;
  update public.household_members set status='left'
    where household_id=target_household_id and user_id=auth.uid();
end;
$$;
revoke all on function public.leave_household(uuid) from public,anon;
grant execute on function public.leave_household(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
