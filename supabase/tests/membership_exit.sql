begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); h uuid:=gen_random_uuid(); denied boolean;
begin
  insert into auth.users(id,email) values(a,a::text||'@exit-test.invalid'),(b,b::text||'@exit-test.invalid'),(outsider,outsider::text||'@exit-test.invalid');
  insert into public.households(id,name,invite_code,created_by) values(h,'Exit regression',h::text,a);
  insert into public.household_members(household_id,user_id,display_name,role,status) values(h,a,'Owner','owner','active'),(h,b,'Member','member','active');
  perform set_config('request.headers','{"x-sweetmate-chore-policy":"single-obligation-v1"}',true);
  perform set_config('request.jwt.claim.sub',a::text,true);
  denied:=false;
  begin perform public.leave_household(h);
  exception when others then if sqlerrm not like 'Transfer ownership%' then raise; end if; denied:=true; end;
  if not denied or not public.is_household_member(h) then raise exception 'Owner left a household with active roommates'; end if;
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  denied:=false;
  begin perform public.leave_household(h);
  exception when others then if sqlerrm<>'Active membership required' then raise; end if; denied:=true; end;
  if not denied then raise exception 'Outsider changed membership'; end if;
  perform set_config('request.jwt.claim.sub',b::text,true);
  perform public.leave_household(h);
  if public.is_household_member(h) then raise exception 'Departed member kept active access'; end if;
  execute 'set local role authenticated';
  if not exists(select 1 from public.household_members where household_id=h and user_id=b and status='left')
    then raise exception 'Departed member cannot observe their own access revocation'; end if;
  if exists(select 1 from public.household_members where household_id=h and user_id<>b)
    or exists(select 1 from public.households where id=h)
    then raise exception 'Departed member can read another member or household'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.leave_household(h);
  if public.is_household_member(h) or not exists(select 1 from public.households where id=h)
    then raise exception 'Sole member leaving should revoke membership without deleting household history'; end if;
  if exists(select 1 from public.household_members where household_id=h and status='active') then raise exception 'Departure did not persist'; end if;
end $$;
rollback;
select 'Membership exit ownership tests passed' as result;
