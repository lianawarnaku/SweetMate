-- Run from the repository root against a local QA database using psql -v ON_ERROR_STOP=1.
-- Includes the migration in a transaction and leaves all data unchanged.
begin;
\i supabase/migrations/202611220001_household_setup_completion.sql
-- Test-owned fixtures; every write is rolled back at the end.
insert into auth.users(id) values ('f0000000-0000-4000-8000-000000000051'),('f0000000-0000-4000-8000-000000000052');
insert into public.households(id,name,invite_code,created_by) values ('f0000000-0000-4000-8000-000000000050','Setup recovery regression','QARECOV1','f0000000-0000-4000-8000-000000000051');
insert into public.household_members(household_id,user_id,display_name,role,status) values
('f0000000-0000-4000-8000-000000000050','f0000000-0000-4000-8000-000000000051','Test host','owner','active'),
('f0000000-0000-4000-8000-000000000050','f0000000-0000-4000-8000-000000000052','Test roommate','member','active');
insert into public.household_states(household_key,household_id,state,updated_by) values
('f0000000-0000-4000-8000-000000000050','f0000000-0000-4000-8000-000000000050','{"homeProfile":null,"customTasks":[{"id":"keep-custom"}],"essentialOwned":{"kitchen":{"kettle":true}},"liveChart":[{"memberId":"keep-assignment"}]}','f0000000-0000-4000-8000-000000000051');
insert into public.household_preferences(household_id,household_complete,updated_by) values ('f0000000-0000-4000-8000-000000000050',false,'f0000000-0000-4000-8000-000000000051');
insert into public.member_task_preferences(household_id,member_id,key,value) values
('f0000000-0000-4000-8000-000000000050','f0000000-0000-4000-8000-000000000051','morning',67),
('f0000000-0000-4000-8000-000000000050','f0000000-0000-4000-8000-000000000052','night',83);

create temp table setup_before as
select h.id,
  s.state as shared_state,
  (select jsonb_agg(to_jsonb(m) order by m.user_id) from public.household_members m where m.household_id=h.id) as members,
  (select jsonb_agg(to_jsonb(p) order by p.member_id,p.key) from public.member_task_preferences p where p.household_id=h.id) as preferences,
  (select jsonb_agg(to_jsonb(c) order by c.id) from public.chores c where c.household_id=h.id) as chores,
  (select jsonb_agg(to_jsonb(e) order by e.id) from public.expenses e where e.household_id=h.id) as expenses,
  (select jsonb_agg(to_jsonb(l) order by l.id) from public.shopping_lists l where l.household_id=h.id) as lists,
  (select jsonb_agg(to_jsonb(b) order by b.id) from public.shared_borrow_items b where b.household_id=h.id) as borrowing
from public.households h join public.household_states s on s.household_id=h.id where h.id='f0000000-0000-4000-8000-000000000050';
select set_config('request.jwt.claim.sub',(select user_id::text from public.household_members where household_id=(select id from setup_before) and status='active' order by role desc limit 1),true);
set local role authenticated;
select public.finish_household_setup('f0000000-0000-4000-8000-000000000050', '{"housingType":"apartment","items":["kitchen:Trash can"],"additionalChores":[],"roomCounts":{"bathroom":1,"bedroom":1}}');
reset role;
do $$
declare b record; current_state jsonb;
begin
  select * into strict b from setup_before;
  select state into current_state from public.household_states where household_id=b.id;
  if (current_state - 'homeProfile') is distinct from (b.shared_state - 'homeProfile') then raise exception 'Unrelated shared fields changed'; end if;
  if current_state->'homeProfile'->>'housingType' <> 'apartment' then raise exception 'Home profile missing'; end if;
  if not (select household_complete from public.household_preferences where household_id=b.id) then raise exception 'Completion missing'; end if;
  if b.members is distinct from (select jsonb_agg(to_jsonb(m) order by m.user_id) from public.household_members m where m.household_id=b.id) then raise exception 'Membership changed'; end if;
  if b.preferences is distinct from (select jsonb_agg(to_jsonb(p) order by p.member_id,p.key) from public.member_task_preferences p where p.household_id=b.id) then raise exception 'Preferences changed'; end if;
  if b.chores is distinct from (select jsonb_agg(to_jsonb(c) order by c.id) from public.chores c where c.household_id=b.id) then raise exception 'Chores changed'; end if;
  if b.expenses is distinct from (select jsonb_agg(to_jsonb(e) order by e.id) from public.expenses e where e.household_id=b.id) then raise exception 'Expenses changed'; end if;
  if b.lists is distinct from (select jsonb_agg(to_jsonb(l) order by l.id) from public.shopping_lists l where l.household_id=b.id) then raise exception 'Shopping changed'; end if;
  if b.borrowing is distinct from (select jsonb_agg(to_jsonb(v) order by v.id) from public.shared_borrow_items v where v.household_id=b.id) then raise exception 'Borrowing changed'; end if;
  update public.household_preferences set household_complete=false where household_id=b.id;
  if not (select household_complete from public.household_preferences where household_id=b.id) then raise exception 'Stale client relocked setup'; end if;
  update public.household_states set state=jsonb_set(state,'{homeProfile}','null') where household_id=b.id;
  if (select state->'homeProfile' from public.household_states where household_id=b.id) is distinct from current_state->'homeProfile' then raise exception 'Stale snapshot erased profile'; end if;
  begin
    perform public.finish_household_setup(b.id,'{"housingType":"invalid","items":[],"additionalChores":[]}');
    raise exception 'Invalid profile accepted';
  exception when others then if SQLERRM='Invalid profile accepted' then raise; end if; end;
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
  begin
    perform public.finish_household_setup(b.id,current_state->'homeProfile');
    raise exception 'Nonmember accepted';
  exception when others then if SQLERRM='Nonmember accepted' then raise; end if; end;
  raise notice 'PASS: authenticated completion, profile persistence, unchanged members/preferences/chores/expenses/shopping/borrowing, stale-client protection, invalid profile and nonmember rejection';
end $$;
-- Force a failure after the profile update to prove the RPC is atomic.
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000051',true);
create function pg_temp.reject_setup_save() returns trigger language plpgsql as $$
begin raise exception 'intentional setup-save failure'; end $$;
create trigger reject_setup_save before update on public.household_preferences
for each row execute function pg_temp.reject_setup_save();
do $$
declare before_profile jsonb;
begin
  select state->'homeProfile' into before_profile from public.household_states where household_id='f0000000-0000-4000-8000-000000000050';
  begin
    perform public.finish_household_setup('f0000000-0000-4000-8000-000000000050','{"housingType":"suite","items":[],"additionalChores":[]}');
    raise exception 'Expected failed completion save';
  exception when others then if SQLERRM <> 'intentional setup-save failure' then raise; end if; end;
  if (select state->'homeProfile' from public.household_states where household_id='f0000000-0000-4000-8000-000000000050') is distinct from before_profile then raise exception 'Failed completion leaked a profile change'; end if;
  if has_function_privilege('anon','public.finish_household_setup(uuid,jsonb)','EXECUTE') then raise exception 'Anonymous completion allowed'; end if;
  raise notice 'PASS: atomic rollback on completion failure and anonymous access denied';
end $$;
rollback;
