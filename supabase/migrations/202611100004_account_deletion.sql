-- Applied together with the authenticated delete-account Edge Function and a
-- new mobile build. No live accounts are deleted by this migration.
begin;
create table public.deleted_member_aliases (
  household_id uuid not null references public.households(id) on delete cascade,
  original_hash text not null,
  id uuid not null default gen_random_uuid(),
  primary key(household_id,original_hash), unique(household_id,id)
);
alter table public.deleted_member_aliases enable row level security;
revoke all on public.deleted_member_aliases from public,anon,authenticated;

create view public.former_household_members with (security_barrier=true) as
select household_id,id,'Deleted member'::text as display_name
from public.deleted_member_aliases where public.is_household_member(household_id);
revoke all on public.former_household_members from public,anon;
grant select on public.former_household_members to authenticated;

create table public.account_deletion_transactions(transaction_id bigint primary key);
alter table public.account_deletion_transactions enable row level security;
revoke all on public.account_deletion_transactions from public,anon,authenticated;
-- A support task, not a claim that vendor-side deletion already happened.
-- No auth user ID/name/email is retained after account deletion.
create table public.vendor_erasure_requests(
  id uuid primary key default gen_random_uuid(),
  analytics_id text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(analytics_id)
);
alter table public.vendor_erasure_requests enable row level security;
revoke all on public.vendor_erasure_requests from public,anon,authenticated;

create function public.deleted_member_alias(p_household uuid,p_value text)
returns text language sql stable security definer set search_path=pg_catalog,public,extensions as $$
  select id::text from public.deleted_member_aliases
  where household_id=p_household and original_hash=encode(sha256(convert_to(p_value,'UTF8')),'hex')
$$;
revoke all on function public.deleted_member_alias(uuid,text) from public,anon,authenticated;

create function public.scrub_deleted_members(p_household uuid,p_value jsonb)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb; pair record; replacement text; profile_alias text;
begin
  if p_value is null then return null; end if;
  if jsonb_typeof(p_value)='string' then
    replacement:=public.deleted_member_alias(p_household,p_value#>>'{}');
    return case when replacement is null then p_value else to_jsonb(replacement) end;
  elsif jsonb_typeof(p_value)='array' then
    select coalesce(jsonb_agg(public.scrub_deleted_members(p_household,value) order by ordinality),'[]'::jsonb) into result
    from jsonb_array_elements(p_value) with ordinality;
    return result;
  elsif jsonb_typeof(p_value)='object' then
    result:='{}';
    for pair in select key,value from jsonb_each(p_value) loop
      replacement:=coalesce(public.deleted_member_alias(p_household,pair.key),pair.key);
      result:=result||jsonb_build_object(replacement,public.scrub_deleted_members(p_household,pair.value));
    end loop;
    profile_alias:=public.deleted_member_alias(p_household,coalesce(p_value->>'id',p_value->>'user_id'));
    if profile_alias is not null and (p_value ? 'name' or p_value ? 'display_name' or p_value ? 'avatarUri') then
      result:=jsonb_build_object('id',profile_alias,'name','Deleted member','display_name','Deleted member','color','#808080','points',0,'weeklyPoints',0);
    end if;
    -- Removed people must not remain in future chore rotations or assignments.
    foreach replacement in array array['roundRobinParticipantIds','excludedParticipantIds'] loop
      if jsonb_typeof(result->replacement)='array' then
        select coalesce(jsonb_agg(value),'[]'::jsonb) into p_value from jsonb_array_elements(result->replacement)
        where not exists(select 1 from public.deleted_member_aliases a where a.household_id=p_household and a.id::text=value#>>'{}');
        result:=jsonb_set(result,array[replacement],p_value);
      end if;
    end loop;
    if result->>'assignmentMode'='specific-person' and exists(select 1 from public.deleted_member_aliases a where a.household_id=p_household and a.id::text=result->>'assignedTo') then
      result:=result||jsonb_build_object('assignedTo','','assignmentMode','unassigned');
    end if;
    return result;
  end if;
  return p_value;
end $$;
revoke all on function public.scrub_deleted_members(uuid,jsonb) from public,anon,authenticated;

-- A deleted payer/lender remains a non-login, household-local anonymous record.
-- Normal application writes still require valid active participants; stale
-- snapshots are sanitized on every subsequent write.
alter table public.expenses drop constraint expenses_paid_by_fkey;
alter table public.shared_borrow_items drop constraint shared_borrow_items_borrowed_from_fkey;

create function public.sanitize_deleted_member_write()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare data jsonb:=to_jsonb(new); household uuid:=new.household_id; col record; replacement text; filtered jsonb;
begin
  for col in select column_name,data_type,udt_name,is_nullable from information_schema.columns where table_schema=tg_table_schema and table_name=tg_table_name loop
    if col.data_type='jsonb' then data:=jsonb_set(data,array[col.column_name],coalesce(public.scrub_deleted_members(household,data->col.column_name),'null'::jsonb));
    elsif col.column_name not in ('id','household_id') and col.data_type='uuid' then
      replacement:=public.deleted_member_alias(household,data->>col.column_name);
      if replacement is not null then
        if exists(select 1 from pg_constraint c join pg_attribute att on att.attrelid=c.conrelid and att.attnum=any(c.conkey)
          where c.contype='f' and c.conrelid=tg_relid and c.confrelid='auth.users'::regclass and att.attname=col.column_name) then
          if col.is_nullable='YES' then data:=jsonb_set(data,array[col.column_name],'null'); end if;
        else data:=jsonb_set(data,array[col.column_name],to_jsonb(replacement)); end if;
      end if;
    elsif col.data_type='ARRAY' and col.udt_name in ('_uuid','_text') then
      data:=jsonb_set(data,array[col.column_name],coalesce(public.scrub_deleted_members(household,data->col.column_name),'null'::jsonb));
    end if;
  end loop;
  if tg_table_name='chores' then
    if data->>'assigned_to' is null and not coalesce((data->>'completed')::boolean,false) then data:=data||jsonb_build_object('assignment_mode','unassigned'); end if;
    for col in select unnest(array['round_robin_participant_ids','excluded_participant_ids']) as column_name loop
      select coalesce(jsonb_agg(value),'[]'::jsonb) into filtered from jsonb_array_elements(data->col.column_name)
      where not exists(select 1 from public.deleted_member_aliases a where a.household_id=household and a.id::text=value#>>'{}');
      data:=jsonb_set(data,array[col.column_name],filtered);
    end loop;
    data:=jsonb_set(data,'{round_robin_cursor}',to_jsonb(case when jsonb_array_length(data->'round_robin_participant_ids')=0 then 0 else coalesce((data->>'round_robin_cursor')::int,0) % jsonb_array_length(data->'round_robin_participant_ids') end));
  end if;
  if tg_table_name in ('expenses','shared_borrow_items') then
    replacement:=data->>(case when tg_table_name='expenses' then 'paid_by' else 'borrowed_from' end);
    if replacement is not null and not exists(select 1 from auth.users where id::text=replacement)
      and not exists(select 1 from public.deleted_member_aliases where household_id=household and id::text=replacement) then
      raise exception 'Unknown household record participant' using errcode='23503';
    end if;
  end if;
  new:=jsonb_populate_record(new,data);
  return new;
end $$;
revoke all on function public.sanitize_deleted_member_write() from public,anon,authenticated;

do $$ declare tab record; definition text; guard_name text;
begin
  -- Only the deletion transaction can enter the expense maintenance branch.
  -- A client-set GUC, actor ID, or custom header grants no additional access.
  foreach guard_name in array array['expense_write_guard','protect_expense_payment_history','protect_expense_activity','validate_household_borrow_transactions','require_current_chore_policy','guard_legacy_chore_scores','enforce_single_chore_obligation','enforce_chore_series_retirement'] loop
    if to_regprocedure('public.'||guard_name||'()') is null then continue; end if;
    definition:=pg_get_functiondef(to_regprocedure('public.'||guard_name||'()'));
    definition:=regexp_replace(definition,'\mbegin\M',
      E'begin\n  if exists(select 1 from public.account_deletion_transactions where transaction_id=txid_current()) then\n    if tg_op=''DELETE'' then return old; else return new; end if;\n  end if;', 'i');
    execute definition;
  end loop;
  for tab in select distinct table_name from information_schema.columns
    where table_schema='public' and column_name='household_id'
    and table_name not in ('household_members','deleted_member_aliases','former_household_members')
    and exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=table_name and c.relkind='r')
  loop
    execute format('create trigger aa_sanitize_deleted_members before insert or update on public.%I for each row execute function public.sanitize_deleted_member_write()',tab.table_name);
  end loop;
end $$;

create function public.prepare_account_deletion(target_user_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public,auth as $$
begin
  if target_user_id is null or not exists(select 1 from auth.users where id=target_user_id) then raise exception 'Account no longer exists'; end if;
end $$;

create function public.finalize_account_deletion(target_user_id uuid,analytics_id text default null)
returns void language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare home record; successor uuid; col record; anonymous_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||target_user_id::text,0));
  perform 1 from auth.users where id=target_user_id for update;
  if not found then return; end if;
  insert into public.account_deletion_transactions values(txid_current()) on conflict do nothing;
  -- Remove private messages before nullable author FKs are scrubbed.
  delete from public.nudges where sent_by=target_user_id or to_member_id=target_user_id;
  -- Deterministic lock order also serializes concurrent deletions in a Sweet.
  for home in select h.id from public.households h where h.created_by=target_user_id or exists(select 1 from public.household_members m where m.household_id=h.id and m.user_id=target_user_id) order by h.id for update loop
    successor:=null;
    select user_id into successor from public.household_members where household_id=home.id and user_id<>target_user_id and status='active' order by (role='owner') desc,joined_at,user_id limit 1 for update;
    if successor is null then
      -- A departed member must never delete an unrelated owner's empty Sweet.
      if exists(select 1 from public.households where id=home.id and created_by=target_user_id) then delete from public.households where id=home.id; continue; end if;
    elsif exists(select 1 from public.households where id=home.id and created_by=target_user_id) or exists(select 1 from public.household_members where household_id=home.id and user_id=target_user_id and role='owner' and status='active') then
      update public.household_members set role='owner' where household_id=home.id and user_id=successor;
      update public.households set created_by=successor where id=home.id and created_by=target_user_id;
    end if;
    insert into public.deleted_member_aliases(household_id,original_hash) values(home.id,encode(sha256(convert_to(target_user_id::text,'UTF8')),'hex')) on conflict do nothing;
    select id into anonymous_id from public.deleted_member_aliases where household_id=home.id and original_hash=encode(sha256(convert_to(target_user_id::text,'UTF8')),'hex');
    -- Updating a row invokes the sanitizer above for JSON, UUID and map keys.
    for col in select c.table_name,min(c.column_name) as column_name from information_schema.columns c
      where c.table_schema='public' and c.column_name<>'household_id' and c.table_name not in ('household_members','deleted_member_aliases','former_household_members')
      and c.table_name in (select table_name from information_schema.columns where table_schema='public' and column_name='household_id')
      and exists(select 1 from pg_class p join pg_namespace n on n.oid=p.relnamespace where n.nspname='public' and p.relname=c.table_name and p.relkind='r')
      group by c.table_name
    loop
      execute format('update public.%I set %I=%I where household_id=$1',col.table_name,col.column_name,col.column_name) using home.id;
    end loop;
    update public.proposed_charts set status='cancelled' where household_id=home.id and status='pending';
  end loop;
  delete from public.feedback where user_id=target_user_id;
  delete from public.nudges where sent_by=target_user_id or to_member_id=target_user_id;
  if analytics_id is not null then
    if analytics_id !~ '^sm_[a-zA-Z0-9_-]{8,128}$' then raise exception 'Invalid analytics identifier'; end if;
    insert into public.vendor_erasure_requests(analytics_id) values(analytics_id) on conflict do nothing;
  end if;
  delete from auth.users where id=target_user_id;
  delete from public.account_deletion_transactions where transaction_id=txid_current();
end $$;

-- Legacy clients cannot bypass provider revocation by calling the old RPC.
create or replace function public.delete_own_account()
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin raise exception 'Update SweetMate before deleting your account.' using errcode='0A000'; end $$;
revoke all on function public.prepare_account_deletion(uuid),public.finalize_account_deletion(uuid,text) from public,anon,authenticated;
grant execute on function public.prepare_account_deletion(uuid),public.finalize_account_deletion(uuid,text) to service_role;

commit;
