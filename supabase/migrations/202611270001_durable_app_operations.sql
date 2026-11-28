-- Atomically commit each app mutation together with a per-account receipt.
-- SECURITY INVOKER preserves the existing grants, RLS, validation and triggers.
create table public.app_operation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key(user_id, operation_id)
);
alter table public.app_operation_receipts enable row level security;
create policy own_operation_receipts on public.app_operation_receipts to authenticated
  using(user_id=auth.uid()) with check(user_id=auth.uid());
revoke all on public.app_operation_receipts from public, anon, authenticated;
grant select, insert on public.app_operation_receipts to authenticated;

create or replace function public.execute_app_operation(operation_id uuid, operation_request jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
  actor uuid:=auth.uid(); request_hash text; receipt public.app_operation_receipts;
  target text:=operation_request->>'name'; method text:=operation_request->>'method';
  body jsonb:=operation_request->'body'; pair jsonb; col text; value text; filter_sql text:='';
  prefer text:=coalesce(operation_request->>'prefer',''); accept text:=coalesce(operation_request->>'accept','');
  conflict_keys text; columns_sql text; values_sql text; changes_sql text; argument_defs text; arguments_sql text;
  row_value jsonb; changed jsonb; result jsonb:='[]'; response jsonb; stmt text;
  fn record; admission_target uuid; batch_index integer:=0; projection text; returning_sql text;
begin
  if actor is null then raise exception 'Sign in before saving' using errcode='42501'; end if;
  if operation_id is null or operation_request is null or octet_length(operation_request::text)>8388608 then
    raise exception 'Invalid pending operation' using errcode='22023';
  end if;
  request_hash:=encode(sha256(convert_to(operation_request::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||operation_id::text,0));
  select * into receipt from public.app_operation_receipts r where r.user_id=actor and r.operation_id=execute_app_operation.operation_id;
  if found then
    if receipt.request_hash<>request_hash then raise exception 'Operation ID reused for a different change' using errcode='22023'; end if;
    -- A past join receipt is not a current membership grant. In particular,
    -- retrying a pre-removal join must not even report a successful admission.
    if target in ('join_household','redeem_household_invite') then
      admission_target:=case when jsonb_typeof(receipt.response->'data')='string' then (receipt.response->>'data')::uuid
        when receipt.response->'data'->>'ok'='true' then (receipt.response->'data'->>'household_id')::uuid else null end;
      if admission_target is not null and not exists(select 1 from public.household_members m where m.household_id=admission_target and m.user_id=actor and m.status='active') then
        return jsonb_build_object('status',403,'data',jsonb_build_object('code','SM_INVITE_REVOKED','message','You no longer have access to this household. Ask the host for a fresh invitation or approval.'));
      end if;
    end if;
    return receipt.response;
  end if;
  if target='batch' then
    if method<>'POST' or jsonb_typeof(body)<>'array' or jsonb_array_length(body)>20 or exists(select 1 from jsonb_array_elements(body) e where e->>'name'=any(array['batch','join_household','redeem_household_invite'])) then
      raise exception 'Invalid mutation batch' using errcode='22023';
    end if;
    result:='[]'::jsonb;
    for row_value in select e.value from jsonb_array_elements(body) e loop
      batch_index:=batch_index+1;
      changed:=public.execute_app_operation(md5(operation_id::text||':'||batch_index::text)::uuid,row_value);
      result:=result||jsonb_build_array(changed);
    end loop;
    response:=jsonb_build_object('status',200,'data',result);
  elsif (operation_request->>'rpc')::boolean then
    if method<>'POST' or target<>all(array['finish_household_setup','update_generated_task_settings','create_household','join_household','leave_household','delete_household','remove_household_member','save_sweet_essential_shortlist','seed_item_difficulty','replace_proposed_chart','cancel_proposed_charts','submit_chore_chart_review','approve_proposed_chart','force_approve_proposed_chart','restart_chore_chart_review','apply_approved_chore_chart','create_household_random_task','claim_household_random_task','configure_household_schedule','set_schedule_busy_sharing','update_personal_schedule_task','redeem_household_invite','manage_household_invites','create_household_reinvitation','revoke_household_reinvitation']) then
      raise exception 'Unsupported pending action' using errcode='22023';
    end if;
    if jsonb_typeof(body)<>'object' then raise exception 'Invalid action arguments' using errcode='22023'; end if;
    select p.* into fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=target and coalesce(p.proargnames[1:p.pronargs],array[]::text[]) @> array(select jsonb_object_keys(body))
      order by p.pronargs desc limit 1;
    if not found then raise exception 'Unsupported action arguments' using errcode='22023'; end if;
    select string_agg(format('%I %s',fn.proargnames[a.ordinality],format_type(a.type_oid,null)),', ' order by a.ordinality),
      string_agg(format('%I := args.%I',fn.proargnames[a.ordinality],fn.proargnames[a.ordinality]),', ' order by a.ordinality)
      into argument_defs,arguments_sql
      from unnest(fn.proargtypes::oid[]) with ordinality a(type_oid,ordinality)
      where body ? fn.proargnames[a.ordinality];
    if argument_defs is null then
      stmt:=format('select to_jsonb(public.%I())',target);
    elsif fn.proretset then
      stmt:=format('select coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) from jsonb_to_record($1) as args(%s) cross join lateral public.%I(%s) r',argument_defs,target,arguments_sql);
    else
      stmt:=format('select to_jsonb(public.%I(%s)) from jsonb_to_record($1) as args(%s)',target,arguments_sql,argument_defs);
    end if;
    execute stmt into result using body;
    response:=jsonb_build_object('status',200,'data',result);
  else
    if target<>all(array['chores','household_states','household_preferences','shopping_lists','shopping_items','shared_borrow_items','private_borrow_items','sweet_essential_item_assignments','nudges','item_difficulty','member_task_preferences','household_members','recurring_chore_occurrence_keys','chore_chart_restart_notifications']) or method<>all(array['POST','PATCH','DELETE']) then
      raise exception 'Unsupported pending collection' using errcode='22023';
    end if;
    -- Only simple bound filters used by app mutations are accepted. Identifiers are
    -- quoted and validated; values never enter SQL as executable expressions.
    for pair in select e.value from jsonb_array_elements(coalesce(operation_request->'query','[]')) e loop
      col:=pair->>0; value:=pair->>1;
      if col in ('select','on_conflict','columns') then continue; end if;
      if not exists(select 1 from pg_attribute where attrelid=format('public.%I',target)::regclass and attname=col and attnum>0 and not attisdropped) then
        raise exception 'Unsupported save filter' using errcode='22023';
      end if;
      if left(value,3)='eq.' then
        filter_sql:=filter_sql||format(' and t.%I::text = %L',col,substr(value,4));
      elsif value='is.null' then
        filter_sql:=filter_sql||format(' and t.%I is null',col);
      elsif left(value,4)='in.(' and right(value,1)=')' then
        filter_sql:=filter_sql||format(' and t.%I::text = any(%L::text[])',col,
          array(select trim(both '"' from x) from unnest(string_to_array(substr(value,5,length(value)-5),',')) x));
      else raise exception 'Unsupported save filter operator' using errcode='22023'; end if;
    end loop;
    projection:=coalesce((select q->>1 from jsonb_array_elements(operation_request->'query') q where q->>0='select' limit 1),'*');
    if projection='*' then returning_sql:='t.*';
    else
      if exists(select 1 from unnest(string_to_array(projection,',')) k where not exists(select 1 from pg_attribute a where a.attrelid=format('public.%I',target)::regclass and a.attname=k and a.attnum>0 and not a.attisdropped)) then
        raise exception 'Unsupported saved-row selection' using errcode='22023';
      end if;
      select string_agg(format('t.%I',k),', ') into returning_sql from unnest(string_to_array(projection,',')) k;
    end if;
    if method in ('PATCH','DELETE') and filter_sql='' then raise exception 'A save target is required' using errcode='22023'; end if;
    if method='DELETE' then
      stmt:=format('delete from public.%I t where true %s',target,filter_sql);
      if prefer like '%return=representation%' then
        execute 'with changed as ('||stmt||' returning '||returning_sql||') select coalesce(jsonb_agg(to_jsonb(changed)),''[]''::jsonb) from changed' into result;
      else execute stmt; result:=null; end if;
    else
      for row_value in select e.value from jsonb_array_elements(case when jsonb_typeof(body)='array' then body else jsonb_build_array(body) end) e loop
        if jsonb_typeof(row_value)<>'object' or row_value='{}' then raise exception 'Invalid save row' using errcode='22023'; end if;
        if exists(select 1 from jsonb_object_keys(row_value) k where not exists(select 1 from pg_attribute a where a.attrelid=format('public.%I',target)::regclass and a.attname=k and a.attnum>0 and not a.attisdropped and a.attgenerated='')) then
          raise exception 'Unsupported save field' using errcode='22023';
        end if;
        select string_agg(format('%I',k),', ' order by k),string_agg(format('r.%I',k),', ' order by k),
          string_agg(format('%I=r.%I',k,k),', ' order by k) into columns_sql,values_sql,changes_sql from jsonb_object_keys(row_value) k;
        if method='PATCH' then
          stmt:=format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) r where true %s',target,changes_sql,target,filter_sql);
        else
          stmt:=format('insert into public.%I as t (%s) select %s from jsonb_populate_record(null::public.%I,$1) r',target,columns_sql,values_sql,target);
          if prefer like '%%resolution=%%' then
            select string_agg(format('%I',k),', ') into conflict_keys from unnest(string_to_array((select q->>1 from jsonb_array_elements(operation_request->'query') q where q->>0='on_conflict' limit 1),',')) k;
            if conflict_keys is null then
              select string_agg(format('%I',a.attname),', ' order by u.n) into conflict_keys from pg_index i
                cross join lateral unnest(i.indkey) with ordinality u(attnum,n) join pg_attribute a on a.attrelid=i.indrelid and a.attnum=u.attnum
                where i.indrelid=format('public.%I',target)::regclass and i.indisprimary;
            end if;
            if conflict_keys is null then raise exception 'A unique save key is required' using errcode='22023'; end if;
            if prefer like '%%resolution=ignore-duplicates%%' then stmt:=stmt||format(' on conflict (%s) do nothing',conflict_keys);
            else
              select string_agg(format('%I=excluded.%I',k,k),', ' order by k) into changes_sql from jsonb_object_keys(row_value) k;
              stmt:=stmt||format(' on conflict (%s) do update set %s',conflict_keys,changes_sql);
            end if;
          end if;
        end if;
        if prefer like '%return=representation%' then
          stmt:='with changed as ('||stmt||' returning '||returning_sql||') select coalesce(jsonb_agg(to_jsonb(changed)),''[]''::jsonb) from changed';
          execute stmt into changed using row_value; result:=result||changed;
        else execute stmt using row_value; end if;
      end loop;
    end if;
    if prefer like '%%return=representation%%' then
      if accept like '%%vnd.pgrst.object%%' then
        if jsonb_array_length(result)<>1 then
          raise exception 'Expected one saved row' using errcode='P0001';
        end if;
        result:=result->0;
      end if;
    else result:=null; end if;
    response:=jsonb_build_object('status',case when method='POST' then 201 when result is null then 204 else 200 end,'data',result);
  end if;
  insert into public.app_operation_receipts(user_id,operation_id,request_hash,response)
    values(actor,execute_app_operation.operation_id,request_hash,response);
  return response;
end $$;
revoke all on function public.execute_app_operation(uuid,jsonb) from public,anon;
grant execute on function public.execute_app_operation(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
