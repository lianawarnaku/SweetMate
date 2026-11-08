-- Staged with the ledger-aware client. Not applied live by this change.
-- Partial repayment and void state require an updated client for accurate UI.
-- Apply through the normal transactional migration runner: prevent a legacy
-- write/insert from falling between balance backfill and trigger cutover.
lock table public.expenses in access exclusive mode;
create table public.expense_payments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  expense_id text not null references public.expenses(id) on delete cascade deferrable initially deferred,
  actor_id uuid not null,
  amount_cents bigint not null check(amount_cents > 0 and amount_cents <= 9007199254740991),
  payment_date date not null,
  recorded_at timestamptz not null default clock_timestamp(),
  reversed_at timestamptz,
  reversed_by uuid,
  source text not null default 'user' check(source in ('user','legacy')),
  check((reversed_at is null) = (reversed_by is null)),
  check(reversed_by is null or reversed_by=actor_id)
);
create index expense_payments_expense_idx on public.expense_payments(household_id,expense_id,recorded_at,id);
create unique index expense_payments_one_legacy_import_idx on public.expense_payments(expense_id,actor_id) where source='legacy';
create table public.expense_activity (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  expense_id text not null references public.expenses(id) on delete cascade deferrable initially deferred,
  actor_id uuid,
  action text not null check(action in ('create','update','repay','undo_repay','settle','reopen','void','restore','import')),
  amount_cents bigint check(amount_cents is null or (amount_cents>0 and amount_cents<=9007199254740991)),
  payment_id uuid,
  summary text not null,
  operation_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  unique(household_id,operation_id)
);
create index expense_activity_household_idx on public.expense_activity(household_id,created_at desc,id);
create index expense_activity_expense_idx on public.expense_activity(household_id,expense_id,created_at desc,id);
alter table public.expense_payments enable row level security;
alter table public.expense_activity enable row level security;
revoke all on public.expense_payments,public.expense_activity from public,anon,authenticated;
grant select on public.expense_payments,public.expense_activity to authenticated;
create policy "members read expense payments" on public.expense_payments for select to authenticated using(public.is_household_member(household_id));
create policy "members read expense activity" on public.expense_activity for select to authenticated using(public.is_household_member(household_id));
alter table public.expense_activity replica identity full;
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='expense_activity') then
    alter publication supabase_realtime add table public.expense_activity;
  end if;
end $$;

create or replace function public.expense_local_payment_date(p_household_id uuid,p_date text default null)
returns date language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare zone text; result date;
begin
  if p_date is not null then
    if p_date !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Payment date must be YYYY-MM-DD'; end if;
    result := p_date::date;
    if to_char(result,'YYYY-MM-DD') <> p_date then raise exception 'Payment date must be YYYY-MM-DD'; end if;
    return result;
  end if;
  select coalesce(to_jsonb(h)->>'timezone','UTC') into zone from public.households h where h.id=p_household_id;
  if zone is null or not exists(select 1 from pg_timezone_names where name=zone) then zone := 'UTC'; end if;
  return (now() at time zone zone)::date;
end $$;
revoke all on function public.expense_local_payment_date(uuid,text) from public,anon,authenticated;

-- This is the only writer of payment aliases. Client paidBack/repayments/maps
-- are never authoritative; an operation writes the ledger, then this projection.
create or replace function public.expense_payment_projection(p_household_id uuid,p_expense_id text,p_entry jsonb)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare totals jsonb; history jsonb; paid jsonb := '{}'; allocation jsonb; participant text; share bigint; entry jsonb; manual boolean;
begin
  select coalesce(jsonb_object_agg(actor_id::text,total),'{}'::jsonb) into totals
    from (select actor_id,sum(amount_cents)::bigint total from public.expense_payments where household_id=p_household_id and expense_id=p_expense_id and reversed_at is null group by actor_id) p;
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',id,'actorId',actor_id,'amountCents',amount_cents,'date',payment_date,
    'recordedAt',recorded_at,'reversedAt',reversed_at,'reversedBy',reversed_by,'legacy',source='legacy')) order by recorded_at,id),'[]'::jsonb)
    into history from public.expense_payments where household_id=p_household_id and expense_id=p_expense_id;
  for allocation in select value from jsonb_array_elements(p_entry->'allocations') loop
    participant := allocation->>'participantId'; share := (allocation->>'amountCents')::bigint;
    if participant <> p_entry->>'paidBy' and share>0 and coalesce((totals->>participant)::bigint,0)>=share then paid := paid || jsonb_build_object(participant,true); end if;
  end loop;
  manual := coalesce((p_entry->>'manuallySettled')::boolean,false);
  entry := p_entry || jsonb_build_object('repaymentCents',totals,'repayments',history,'paidBack',paid,'manuallySettled',manual);
  entry := entry || jsonb_build_object('settled',manual or public.expense_is_fully_repaid(entry),
    'financialHistory',coalesce((p_entry->>'financialHistory')::boolean,false) or jsonb_array_length(history)>0 or manual or coalesce((p_entry->>'settled')::boolean,false) or nullif(p_entry->>'voidedAt','') is not null);
  return entry;
end $$;
revoke all on function public.expense_payment_projection(uuid,text,jsonb) from public,anon,authenticated;

-- Import true legacy acknowledgements once as full-share payment facts. The
-- original payment date was never recorded; use the old recorded update day,
-- label it legacy, and describe the import rather than invent a user action.
do $$
#variable_conflict use_variable
declare e public.expenses; entry jsonb; allocation jsonb; participant text; share bigint; recorded_day date;
begin
  for e in select * from public.expenses for update loop
    entry := public.canonical_expense_entry(e.household_id,e.id,e.creator_id,e.entry || jsonb_build_object('paidBy',e.paid_by,'amountCents',e.amount_cents,'date',e.expense_date),false);
    for allocation in select value from jsonb_array_elements(entry->'allocations') loop
      participant := allocation->>'participantId'; share := (allocation->>'amountCents')::bigint;
      if participant <> e.paid_by::text and share>0 and entry->'paidBack'->participant='true'::jsonb then
        recorded_day := (e.updated_at at time zone 'UTC')::date;
        insert into public.expense_payments(household_id,expense_id,actor_id,amount_cents,payment_date,recorded_at,source)
          values(e.household_id,e.id,participant::uuid,share,recorded_day,e.updated_at,'legacy');
      end if;
    end loop;
    entry := public.expense_payment_projection(e.household_id,e.id,(entry-array['repayments','repaymentCents','voidedAt','voidedBy','financialHistory']) || jsonb_build_object('financialHistory',e.settled));
    update public.expenses set entry=entry,settled=(entry->>'settled')::boolean where id=e.id;
    insert into public.expense_activity(household_id,expense_id,action,summary)
      values(e.household_id,e.id,'import','Imported existing expense and repayment balances; original payment dates unavailable');
  end loop;
end $$;

create or replace function public.protect_expense_payment_history() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if tg_op='DELETE' then
    if pg_trigger_depth()>1 and (not exists(select 1 from public.households where id=old.household_id) or not exists(select 1 from public.expenses where id=old.expense_id)) then return old; end if;
    raise exception 'Payment history cannot be deleted';
  end if;
  if (new.id,new.household_id,new.expense_id,new.actor_id,new.amount_cents,new.payment_date,new.recorded_at,new.source) is distinct from
     (old.id,old.household_id,old.expense_id,old.actor_id,old.amount_cents,old.payment_date,old.recorded_at,old.source)
     or old.reversed_at is not null or new.reversed_at is null or new.reversed_by is distinct from old.actor_id or auth.uid() is distinct from old.actor_id then
    raise exception 'Payments are immutable; reverse only your own active payment' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.protect_expense_payment_history() from public,anon,authenticated;
create trigger expense_payments_immutable before update or delete on public.expense_payments for each row execute function public.protect_expense_payment_history();
create or replace function public.protect_expense_activity() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if tg_op='DELETE' and pg_trigger_depth()>1 and (not exists(select 1 from public.households where id=old.household_id) or not exists(select 1 from public.expenses where id=old.expense_id)) then return old; end if;
  raise exception 'Expense activity is immutable' using errcode='42501';
end $$;
revoke all on function public.protect_expense_activity() from public,anon,authenticated;
create trigger expense_activity_immutable before update or delete on public.expense_activity for each row execute function public.protect_expense_activity();

create or replace function public.mutate_expense(
  p_household_id uuid,p_operation_id uuid,p_action text,p_expense_id text,
  p_payload jsonb default '{}'::jsonb,p_expected_version bigint default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
#variable_conflict use_variable
declare
  actor uuid := auth.uid(); old_row public.expenses; new_row public.expenses; receipt public.expense_operation_receipts;
  entry jsonb; candidate jsonb; request jsonb; response jsonb; manager boolean; manual boolean; financial_changed boolean;
  source jsonb; share bigint; already_paid bigint; remaining bigint; amount numeric; payment public.expense_payments;
  event_action text := p_action; event_amount bigint; event_payment uuid; event_summary text; receipt_only boolean := false;
  now_text text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if actor is null or p_operation_id is null or nullif(btrim(p_expense_id),'') is null or length(p_expense_id)>240 then raise exception 'Authentication, operation ID and expense ID are required'; end if;
  if p_action is null or p_action not in ('create','update','repay','settle','delete','reopen','undo_repay','restore') or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid expense operation'; end if;
  if p_payload ? '_expectedActorId' and p_payload->>'_expectedActorId' is distinct from actor::text then raise exception 'Expense account changed; retry from the original account' using errcode='42501'; end if;
  receipt_only := coalesce(p_payload->'_receiptOnly'='true'::jsonb,false);
  p_payload := p_payload-array['_expectedActorId','_receiptOnly'];
  if not exists(select 1 from public.household_members where household_id=p_household_id and user_id=actor and status='active') then raise exception 'Active household membership required' using errcode='42501'; end if;
  select * into old_row from public.expenses where id=p_expense_id and household_id=p_household_id for update;
  perform 1 from public.households where id=p_household_id for update;
  perform 1 from public.household_members where household_id=p_household_id and user_id=actor and status='active' for share;
  if not found then raise exception 'Active household membership required' using errcode='42501'; end if;
  request := jsonb_build_object('action',p_action,'id',p_expense_id,'payload',p_payload,'expectedVersion',p_expected_version);
  select * into receipt from public.expense_operation_receipts where household_id=p_household_id and operation_id=p_operation_id;
  if found then
    if receipt.actor_id <> actor or receipt.request <> request then raise exception 'Operation ID was already used for a different request'; end if;
    if receipt.response is null then raise exception 'Expense operation is already in progress'; end if;
    select * into old_row from public.expenses where id=p_expense_id and household_id=p_household_id;
    if old_row.id is null then return jsonb_build_object('expense',null,'deleted',true,'id',p_expense_id); end if;
    return jsonb_build_object('expense',to_jsonb(old_row),'deleted',false,'id',p_expense_id);
  end if;
  if receipt_only then raise exception 'Review the repayment amount/record before trying again' using errcode='P0001'; end if;
  insert into public.expense_operation_receipts(household_id,operation_id,actor_id,request,response) values(p_household_id,p_operation_id,actor,request,null);
  perform set_config('sweetmate.expense_operation',p_operation_id::text,true);
  if old_row.id is null and exists(select 1 from public.expenses where id=p_expense_id) then raise exception 'Expense belongs to another household' using errcode='42501'; end if;
  if p_action='create' then
    if old_row.id is not null or exists(select 1 from public.expense_tombstones where expense_id=p_expense_id) then raise exception 'Expense ID already exists or was deleted' using errcode='23505'; end if;
    if p_payload ? 'creatorId' and p_payload->>'creatorId' <> actor::text then raise exception 'Expense creator must be the authenticated actor'; end if;
    entry := public.canonical_expense_entry(p_household_id,p_expense_id,actor,(p_payload-array['paidBack','repayments','repaymentCents','financialHistory','voidedAt','voidedBy','manuallySettled','resolvedAt','recurring','recurringCustom']) || jsonb_build_object('paidBack','{}'::jsonb,'settled',false,'manuallySettled',false,'financialHistory',false));
    source := public.claim_expense_shopping_source(p_household_id,p_expense_id,(entry->>'amountCents')::bigint,entry->'shoppingSource');
    entry := (entry-'shoppingSource') || jsonb_build_object('createdAt',now_text,'updatedAt',now_text);
    if source is not null then entry := entry || jsonb_build_object('shoppingSource',source); end if;
    entry := public.expense_payment_projection(p_household_id,p_expense_id,entry);
    if (entry->>'settled')::boolean then entry := entry || jsonb_build_object('resolvedAt',now_text); end if;
    insert into public.expenses(id,household_id,paid_by,creator_id,amount_cents,expense_date,settled,entry,created_at,updated_at,version)
      values(p_expense_id,p_household_id,(entry->>'paidBy')::uuid,actor,(entry->>'amountCents')::bigint,(entry->>'date')::date,(entry->>'settled')::boolean,entry,clock_timestamp(),clock_timestamp(),1) returning * into new_row;
    event_summary := 'Created expense'; event_amount := new_row.amount_cents;
  else
    if old_row.id is null then raise exception 'Expense no longer exists' using errcode='P0002'; end if;
    if p_action in ('update','delete','settle','reopen','restore') and (p_expected_version is null or p_expected_version <> old_row.version) then raise exception 'Expense changed; refresh before trying again' using errcode='40001'; end if;
    manager := actor=old_row.paid_by or coalesce(actor=old_row.creator_id,false) or public.is_household_owner(p_household_id,actor);
    entry := public.canonical_expense_entry(p_household_id,p_expense_id,old_row.creator_id,old_row.entry || jsonb_build_object('paidBy',old_row.paid_by,'amountCents',old_row.amount_cents,'date',old_row.expense_date),false);
    entry := public.expense_payment_projection(p_household_id,p_expense_id,entry);
    manual := coalesce((entry->>'manuallySettled')::boolean,false);
    if nullif(entry->>'voidedAt','') is not null and p_action <> 'restore' then raise exception 'Restore the voided expense before making changes'; end if;
    if p_action in ('delete','restore') then
      if not manager then raise exception 'Only the payer, creator or host may void or restore an expense' using errcode='42501'; end if;
      if p_action='delete' then entry := entry || jsonb_build_object('voidedAt',now_text,'voidedBy',actor,'financialHistory',true); event_action := 'void'; event_summary := 'Voided expense';
      else
        if nullif(entry->>'voidedAt','') is null then raise exception 'Expense is not voided'; end if;
        entry := (entry-array['voidedAt','voidedBy']) || jsonb_build_object('financialHistory',true); event_summary := 'Restored expense';
      end if;
    elsif p_action='update' then
      if actor <> coalesce(old_row.creator_id,old_row.paid_by) then raise exception 'Only the expense creator may edit' using errcode='42501'; end if;
      if (p_payload ? 'id' and p_payload->>'id' <> p_expense_id) or (p_payload ? 'creatorId' and p_payload->>'creatorId' is distinct from old_row.creator_id::text) or (p_payload ? 'householdId' and p_payload->>'householdId' <> p_household_id::text) then raise exception 'Expense identity is immutable'; end if;
      if p_payload ? 'shoppingSource' and p_payload->'shoppingSource' is distinct from entry->'shoppingSource' then raise exception 'Shopping source is immutable'; end if;
      candidate := public.canonical_expense_entry(p_household_id,p_expense_id,old_row.creator_id,entry || (p_payload-array['paidBack','repayments','repaymentCents','financialHistory','voidedAt','voidedBy','settled','manuallySettled','resolvedAt','createdAt','updatedAt','version']),false);
      financial_changed := (candidate->'amountCents',candidate->'paidBy',candidate->'sharedWith',candidate->'allocations',candidate->'date',candidate->'splitMode') is distinct from (entry->'amountCents',entry->'paidBy',entry->'sharedWith',entry->'allocations',entry->'date',entry->'splitMode');
      if financial_changed and (coalesce((entry->>'financialHistory')::boolean,false) or exists(select 1 from public.expense_payments where expense_id=p_expense_id)) then raise exception 'Financial fields are locked after payment, reversal or settlement'; end if;
      if entry ? 'shoppingSource' and candidate->'amountCents' is distinct from entry->'amountCents' then raise exception 'Shopping conversion amount is immutable'; end if;
      if financial_changed then candidate := public.canonical_expense_entry(p_household_id,p_expense_id,old_row.creator_id,candidate,true); end if;
      entry := candidate; event_summary := 'Updated expense details';
    elsif p_action in ('settle','reopen') then
      if not manager then raise exception 'Only the payer, creator or host may manage settlement' using errcode='42501'; end if;
      manual := p_action='settle';
      entry := entry || jsonb_build_object('manuallySettled',manual,'financialHistory',true);
      if p_action='reopen' then
        insert into public.expense_legacy_correction_barriers(expense_id,household_id,settlement_reopened) values(p_expense_id,p_household_id,true) on conflict(expense_id) do update set settlement_reopened=true,updated_at=clock_timestamp();
        event_summary := 'Reopened expense';
      else event_summary := 'Settled expense'; end if;
    else
      select (a->>'amountCents')::bigint into share from jsonb_array_elements(entry->'allocations') a where a->>'participantId'=actor::text;
      if actor=old_row.paid_by or coalesce(share,0)<=0 then raise exception 'Only your own positive share may be repaid or undone' using errcode='42501'; end if;
      if p_action='undo_repay' and manual then raise exception 'Reopen the manually settled expense before correcting your repayment'; end if;
      if p_action='repay' then
        already_paid := coalesce((entry->'repaymentCents'->>actor::text)::bigint,0); remaining := share-already_paid;
        amount := case when p_payload ? 'amountCents' then (p_payload->>'amountCents')::numeric else remaining end;
        if amount is null or amount<>trunc(amount) or amount<=0 or amount>remaining or amount>9007199254740991 then raise exception 'Repayment must be positive integer cents within your remaining share'; end if;
        insert into public.expense_payments(household_id,expense_id,actor_id,amount_cents,payment_date)
          values(p_household_id,p_expense_id,actor,amount::bigint,public.expense_local_payment_date(p_household_id,p_payload->>'date')) returning * into payment;
        event_summary := 'Recorded repayment';
      else
        if p_payload ? 'paymentId' then
          select * into payment from public.expense_payments where id=(p_payload->>'paymentId')::uuid and household_id=p_household_id and expense_id=p_expense_id and actor_id=actor and reversed_at is null for update;
        else
          select * into payment from public.expense_payments where household_id=p_household_id and expense_id=p_expense_id and actor_id=actor and reversed_at is null order by recorded_at desc,id desc limit 1 for update;
        end if;
        if payment.id is null then raise exception 'Your active repayment no longer exists' using errcode='42501'; end if;
        update public.expense_payments set reversed_at=clock_timestamp(),reversed_by=actor where id=payment.id;
        insert into public.expense_legacy_correction_barriers(expense_id,household_id,repayment_actor_ids) values(p_expense_id,p_household_id,array[actor]) on conflict(expense_id) do update set repayment_actor_ids=(select array_agg(distinct id) from unnest(expense_legacy_correction_barriers.repayment_actor_ids || array[actor]) id),updated_at=clock_timestamp();
        event_summary := 'Reversed repayment';
      end if;
      event_amount := payment.amount_cents; event_payment := payment.id;
      entry := entry || jsonb_build_object('financialHistory',true);
    end if;
    entry := public.expense_payment_projection(p_household_id,p_expense_id,entry) || jsonb_build_object('updatedAt',now_text);
    if (entry->>'settled')::boolean then entry := entry || jsonb_build_object('resolvedAt',coalesce(old_row.entry->>'resolvedAt',now_text)); else entry := entry-'resolvedAt'; end if;
    update public.expenses set paid_by=(entry->>'paidBy')::uuid,amount_cents=(entry->>'amountCents')::bigint,expense_date=(entry->>'date')::date,settled=(entry->>'settled')::boolean,entry=entry,updated_at=clock_timestamp(),version=old_row.version+1 where id=p_expense_id returning * into new_row;
  end if;
  insert into public.expense_activity(household_id,expense_id,actor_id,action,amount_cents,payment_id,summary,operation_id)
    values(p_household_id,p_expense_id,actor,event_action,event_amount,event_payment,event_summary,p_operation_id);
  response := jsonb_build_object('expense',to_jsonb(new_row),'deleted',false,'id',p_expense_id);
  update public.expense_operation_receipts r set response=response where r.household_id=p_household_id and r.operation_id=p_operation_id;
  perform set_config('sweetmate.expense_operation','',true);
  return response;
end $$;
revoke all on function public.mutate_expense(uuid,uuid,text,text,jsonb,bigint) from public,anon;
grant execute on function public.mutate_expense(uuid,uuid,text,text,jsonb,bigint) to authenticated;

-- Reuse the reviewed version-2 legacy permission/correction checks, then add
-- its accepted new facts to the ledger. Recompile the outer trigger below so
-- no session can retain a plan pointing to the renamed compatibility helper.
alter function public.guard_legacy_expense_write(text,public.expenses,public.expenses) rename to guard_legacy_expense_write_v2;
revoke all on function public.guard_legacy_expense_write_v2(text,public.expenses,public.expenses) from public,anon,authenticated;
create or replace function public.guard_legacy_expense_write(p_operation text,p_old public.expenses,p_new public.expenses)
returns public.expenses language plpgsql security definer set search_path=pg_catalog,public as $$
#variable_conflict use_variable
declare result public.expenses; original public.expenses; pair record; share bigint; remaining bigint;
  new_entry jsonb; payment public.expense_payments; event_action text; event_summary text; amount bigint; payment_id uuid;
begin
  if pg_trigger_depth() <> 1 then raise exception 'Expense guard is trigger-only' using errcode='42501'; end if;
  if p_operation='DELETE' then return public.guard_legacy_expense_write_v2(p_operation,p_old,p_new); end if;
  if p_operation='INSERT' then
    select * into original from public.expenses where id=p_new.id for update;
    if original.id is not null then return public.guard_legacy_expense_write_v2(p_operation,p_old,p_new); end if;
    p_new.entry := p_new.entry-array['repayments','repaymentCents','financialHistory','voidedAt','voidedBy'];
  else
    -- Old clients do not understand partial repayments or void state. Their
    -- snapshots may not replace any derived ledger/correction metadata.
    if nullif(p_old.entry->>'voidedAt','') is not null then return null; end if;
    p_new.entry := (p_new.entry-array['repayments','repaymentCents','financialHistory','voidedAt','voidedBy']) ||
      jsonb_build_object('repayments',coalesce(p_old.entry->'repayments','[]'::jsonb),'repaymentCents',coalesce(p_old.entry->'repaymentCents','{}'::jsonb),'financialHistory',coalesce(p_old.entry->'financialHistory','false'::jsonb));
  end if;
  result := public.guard_legacy_expense_write_v2(p_operation,p_old,p_new);
  if result.id is null then return null; end if;
  if p_operation='INSERT' then event_action := 'create'; event_summary := 'Created expense'; amount := result.amount_cents;
  else
    for pair in select key,value from jsonb_each(result.entry->'paidBack') where value='true'::jsonb loop
      if coalesce(p_old.entry->'paidBack'->pair.key,'false'::jsonb)<>'true'::jsonb then
        select (a->>'amountCents')::bigint into share from jsonb_array_elements(result.entry->'allocations') a where a->>'participantId'=pair.key;
        select share-coalesce(sum(amount_cents),0)::bigint into remaining from public.expense_payments where household_id=result.household_id and expense_id=result.id and actor_id=pair.key::uuid and reversed_at is null;
        if remaining>0 then
          insert into public.expense_payments(household_id,expense_id,actor_id,amount_cents,payment_date)
            values(result.household_id,result.id,pair.key::uuid,remaining,public.expense_local_payment_date(result.household_id)) returning * into payment;
          event_action := 'repay'; event_summary := 'Recorded repayment'; amount := remaining; payment_id := payment.id;
        end if;
      end if;
    end loop;
    if event_action is null then event_action := 'settle'; event_summary := 'Settled expense'; end if;
  end if;
  new_entry := public.expense_payment_projection(result.household_id,result.id,result.entry);
  result.entry := new_entry; result.settled := (new_entry->>'settled')::boolean;
  insert into public.expense_activity(household_id,expense_id,actor_id,action,amount_cents,payment_id,summary)
    values(result.household_id,result.id,auth.uid(),event_action,amount,payment_id,event_summary);
  return result;
end $$;
revoke all on function public.guard_legacy_expense_write(text,public.expenses,public.expenses) from public,anon,authenticated;

create or replace function public.expense_write_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare target_household uuid; target_id text; operation_text text;
begin
  if tg_op='DELETE' then target_household := old.household_id; target_id := old.id;
  else target_household := new.household_id; target_id := new.id; end if;
  -- Household/account cleanup owns parent authorization. Its FK cascade runs
  -- after the parent has gone; preserve it without permitting a direct delete.
  if tg_op='DELETE' and pg_trigger_depth()>1 and not exists(select 1 from public.households where id=old.household_id) then return old; end if;
  operation_text := current_setting('sweetmate.expense_operation',true);
  -- A custom GUC alone grants no authority. The private pending receipt must
  -- belong to this actor, expense and *current transaction*. Only the RPC can
  -- create it, and it is completed before control returns to the caller.
  if exists(select 1 from public.expense_operation_receipts r
    where r.household_id=target_household and r.operation_id::text=operation_text
      and r.actor_id=auth.uid() and r.request->>'id'=target_id
      and r.transaction_id=txid_current() and r.response is null) then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  -- Direct maintenance connections remain available to the schema owner;
  -- SET ROLE authenticated tests and PostgREST requests still take the guard.
  if session_user=current_user and current_setting('role') in ('none',current_user::text) then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_op='DELETE' then perform public.guard_legacy_expense_write(tg_op,old,old); return old;
  elsif tg_op='INSERT' then return public.guard_legacy_expense_write(tg_op,null::public.expenses,new);
  else return public.guard_legacy_expense_write(tg_op,old,new); end if;
end $$;
revoke all on function public.expense_write_guard() from public,anon,authenticated;
