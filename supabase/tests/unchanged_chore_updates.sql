begin;
do $$
declare owner_id uuid:=gen_random_uuid(); home_id uuid:=gen_random_uuid(); chore_id text:='noop-'||gen_random_uuid(); affected integer; denied boolean:=false;
begin
  insert into auth.users(id,email) values(owner_id,owner_id::text||'@noop-test.invalid');
  insert into public.households(id,name,invite_code,created_by) values(home_id,'No-op regression',home_id::text,owner_id);
  insert into public.household_members(household_id,user_id,display_name,role,status) values(home_id,owner_id,'Member','owner','active');
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform set_config('request.headers','{"x-sweetmate-chore-policy":"single-obligation-v1"}',true);
  insert into public.chores(id,household_id,title,creator_id,assigned_to,due_date)
    values(chore_id,home_id,'Saved chore',owner_id,owner_id,clock_timestamp());
  update public.chores set title=title where id=chore_id;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Unchanged updates must not emit another row event'; end if;
  insert into public.chores select c.* from public.chores c where c.id=chore_id
    on conflict(id) do update set title=excluded.title;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Unchanged upsert echoes must not emit another row event'; end if;
  update public.chores set title='Real edit',updated_at=clock_timestamp() where id=chore_id;
  get diagnostics affected=row_count;
  if affected<>1 or not exists(select 1 from public.chores where id=chore_id and title='Real edit') then raise exception 'The backstop dropped a real edit'; end if;
  update public.chores set completed=true,completed_at=clock_timestamp(),completed_by_user_id=owner_id,updated_at=clock_timestamp() where id=chore_id;
  get diagnostics affected=row_count;
  if affected<>1 or not exists(select 1 from public.chores where id=chore_id and completed) then raise exception 'The backstop dropped completion'; end if;
  perform set_config('request.headers','{}',true);
  begin update public.chores set title=title where id=chore_id;
  exception when sqlstate '0A000' then denied:=true; end;
  if not denied then raise exception 'The no-op backstop bypassed the current chore policy guard'; end if;
end;
$$;
rollback;
select 'Unchanged chore echo suppression, real edits, completion, and policy guard tests passed' as result;
