-- Reviewed together with the explicit expense-operation client. NOT applied live
-- by this change. Build 42 may still create and add payment facts safely;
-- its unversioned edits and DELETE are deliberately rejected (upgrade required).
-- Never infer a deletion from absence in a client snapshot.
alter table public.expenses add column if not exists version bigint not null default 1 check (version > 0);
alter table public.expenses replica identity full;

create table public.expense_operation_receipts (
  household_id uuid not null references public.households(id) on delete cascade,
  operation_id uuid not null,
  actor_id uuid not null,
  request jsonb not null,
  response jsonb,
  transaction_id bigint not null default txid_current(),
  created_at timestamptz not null default now(),
  primary key (household_id, operation_id)
);
create table public.expense_tombstones (
  expense_id text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  deleted_by uuid not null,
  deleted_version bigint not null,
  deleted_at timestamptz not null default now()
);
-- Claims deliberately have no expense/shopping FK: deleting either entity must
-- not permit charging the same purchase again. A list represents one cycle;
-- start a new list for a genuinely new shopping trip.
create table public.expense_shopping_claims (
  household_id uuid not null references public.households(id) on delete cascade,
  source_kind text not null check (source_kind in ('shopping-item','shopping-list')),
  source_id text not null,
  list_id text not null,
  expense_id text not null,
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  primary key (household_id, source_kind, source_id)
);
create index expense_shopping_claims_list_idx on public.expense_shopping_claims(household_id,list_id);
-- An old snapshot cannot distinguish an undone payment/reopened settlement
-- from a new affirmative action. Permanent correction barriers require the
-- explicit RPC for later changes to that corrected fact, without clock trust.
create table public.expense_legacy_correction_barriers (
  expense_id text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  repayment_actor_ids uuid[] not null default '{}',
  settlement_reopened boolean not null default false,
  updated_at timestamptz not null default now()
);
create table public.expense_mutation_cutover (
  singleton boolean primary key default true check (singleton),
  enabled_at timestamptz not null default clock_timestamp()
);
insert into public.expense_mutation_cutover(singleton) values(true);

-- Preserve pre-existing records. For historical duplicate item conversions the
-- claim reserves their combined amount; it never silently deletes/refunds debt.
insert into public.expense_shopping_claims(household_id,source_kind,source_id,list_id,expense_id,amount_cents,created_at)
select household_id, entry #>> '{shoppingSource,type}',
  case when entry #>> '{shoppingSource,type}'='shopping-list' then entry #>> '{shoppingSource,shoppingListId}'
    else entry #>> '{shoppingSource,shoppingItemIds,0}' end,
  entry #>> '{shoppingSource,shoppingListId}',
  (array_agg(id order by created_at,id))[1], sum(amount_cents), min(created_at)
from public.expenses
where entry #>> '{shoppingSource,type}' in ('shopping-item','shopping-list')
  and nullif(entry #>> '{shoppingSource,shoppingListId}','') is not null
  and (entry #>> '{shoppingSource,type}'='shopping-list' or nullif(entry #>> '{shoppingSource,shoppingItemIds,0}','') is not null)
  and amount_cents > 0
group by household_id,entry #>> '{shoppingSource,type}',
  case when entry #>> '{shoppingSource,type}'='shopping-list' then entry #>> '{shoppingSource,shoppingListId}'
    else entry #>> '{shoppingSource,shoppingItemIds,0}' end,entry #>> '{shoppingSource,shoppingListId}';

alter table public.expense_operation_receipts enable row level security;
alter table public.expense_tombstones enable row level security;
alter table public.expense_shopping_claims enable row level security;
alter table public.expense_mutation_cutover enable row level security;
alter table public.expense_legacy_correction_barriers enable row level security;
revoke all on public.expense_operation_receipts,public.expense_tombstones,public.expense_shopping_claims,public.expense_mutation_cutover,public.expense_legacy_correction_barriers from public,anon,authenticated;
create policy "members read expense tombstones" on public.expense_tombstones for select to authenticated using (public.is_household_member(household_id));
grant select on public.expense_tombstones to authenticated;

create or replace function public.canonical_expense_entry(
  p_household_id uuid,p_id text,p_creator_id uuid,p_entry jsonb,p_require_active boolean default true
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
#variable_conflict use_variable
declare
  result jsonb := p_entry; participants jsonb; allocations jsonb := '[]'; splits jsonb := '{}';
  paid jsonb := '{}'; participant text; allocation jsonb; cents numeric; total numeric; allocated numeric := 0;
  payer uuid; day text; count_ids integer; seen text[] := '{}';
begin
  if jsonb_typeof(p_entry) is distinct from 'object' or jsonb_typeof(p_entry->'title') is distinct from 'string' or nullif(btrim(p_entry->>'title'),'') is null then raise exception 'Expense title is required'; end if;
  if p_entry->>'category' is null or p_entry->>'category' not in ('groceries','utilities','rent','entertainment','other') then raise exception 'Invalid expense category'; end if;
  if p_entry ? 'notes' and jsonb_typeof(p_entry->'notes') not in ('string','null') then raise exception 'Expense notes must be text'; end if;
  if p_entry ? 'splitMode' and p_entry->>'splitMode' not in ('equal','exact') then raise exception 'Invalid expense split mode'; end if;
  payer := (p_entry->>'paidBy')::uuid;
  if payer is null then raise exception 'Expense payer is required'; end if;
  if p_require_active and not exists(select 1 from public.household_members where household_id=p_household_id and user_id=payer and status='active') then raise exception 'Expense payer must be an active member'; end if;
  if p_entry ? 'amountCents' then total := (p_entry->>'amountCents')::numeric;
  else total := (p_entry->>'amount')::numeric * 100; end if;
  if total is null or total <> trunc(total) or total <= 0 or total > 9007199254740991 then raise exception 'Expense amount must be positive integer cents'; end if;
  day := p_entry->>'date';
  if day is null or day !~ '^\d{4}-\d{2}-\d{2}$' or to_char(day::date,'YYYY-MM-DD') <> day then raise exception 'Expense date must be YYYY-MM-DD'; end if;
  participants := p_entry->'sharedWith';
  if jsonb_typeof(participants) is distinct from 'array' or jsonb_array_length(participants)=0 then raise exception 'Expense participants are required'; end if;
  if p_entry ? 'allocations' and jsonb_typeof(p_entry->'allocations') is distinct from 'array' then raise exception 'Expense allocations must be an array'; end if;
  for participant in select jsonb_array_elements_text(participants) loop
    if participant=any(seen) then raise exception 'Expense participants must be unique'; end if;
    seen := array_append(seen,participant);
    if participant is null or (p_require_active and not exists(select 1 from public.household_members where household_id=p_household_id and user_id=participant::uuid and status='active')) then raise exception 'Expense participant must be an active member'; end if;
    -- Validate identity even when an existing departed participant is retained.
    perform participant::uuid;
    if p_entry ? 'allocations' then
      select count(*),min(value->>'amountCents')::numeric into count_ids,cents
        from jsonb_array_elements(p_entry->'allocations') where value->>'participantId'=participant;
      if count_ids <> 1 then raise exception 'Exactly one allocation is required per participant'; end if;
    else cents := (p_entry->'splits'->>participant)::numeric * 100; end if;
    if cents is null or cents <> trunc(cents) or cents < 0 or cents > 9007199254740991 then raise exception 'Allocations must be nonnegative integer cents'; end if;
    allocated := allocated+cents;
    allocations := allocations || jsonb_build_array(jsonb_build_object('participantId',participant,'amountCents',cents::bigint));
    splits := splits || jsonb_build_object(participant,cents/100);
    if participant <> payer::text and cents > 0 and p_entry->'paidBack'->participant = 'true'::jsonb then paid := paid || jsonb_build_object(participant,true); end if;
  end loop;
  if allocated <> total or (p_entry ? 'allocations' and jsonb_array_length(p_entry->'allocations') <> cardinality(seen)) then raise exception 'Allocations must exactly match participants and expense total'; end if;
  result := result || jsonb_build_object('id',p_id,'householdId',p_household_id,'creatorId',p_creator_id,'paidBy',payer,'amountCents',total::bigint,'amount',total/100,
    'date',day,'sharedWith',participants,'allocations',allocations,'splits',splits,'paidBack',paid);
  return result;
end $$;
revoke all on function public.canonical_expense_entry(uuid,text,uuid,jsonb,boolean) from public,anon,authenticated;

create or replace function public.expense_is_fully_repaid(p_entry jsonb)
returns boolean language sql immutable set search_path=pg_catalog,public as $$
  select not exists(select 1 from jsonb_array_elements(p_entry->'allocations') a
    where a->>'participantId' <> p_entry->>'paidBy' and (a->>'amountCents')::bigint > 0
      and coalesce(p_entry->'paidBack'->(a->>'participantId'),'false'::jsonb) <> 'true'::jsonb)
$$;
revoke all on function public.expense_is_fully_repaid(jsonb) from public,anon,authenticated;

-- Infer the correction state of legacy settled records, preserving all money
-- and repayment facts. Unsettled and all-positive-shares-repaid records are
-- automatic; a settled record with an unpaid positive share was settled whole.
update public.expenses e set entry=e.entry || jsonb_build_object('manuallySettled',e.settled and (
  exists(select 1 from jsonb_array_elements(case when jsonb_typeof(e.entry->'allocations')='array' then e.entry->'allocations' else '[]'::jsonb end) a
    where a->>'participantId' <> e.paid_by::text
      and case when a->>'amountCents' ~ '^\d+(\.\d+)?$' then (a->>'amountCents')::numeric > 0 else false end
      and coalesce(e.entry->'paidBack'->(a->>'participantId'),'false'::jsonb) <> 'true'::jsonb)
  or (jsonb_typeof(e.entry->'allocations') is distinct from 'array' and exists(
    select 1 from jsonb_each(case when jsonb_typeof(e.entry->'splits')='object' then e.entry->'splits' else '{}'::jsonb end) s
    where s.key <> e.paid_by::text
      and case when s.value#>>'{}' ~ '^\d+(\.\d+)?$' then (s.value#>>'{}')::numeric > 0 else false end
      and coalesce(e.entry->'paidBack'->s.key,'false'::jsonb) <> 'true'::jsonb))
)) where not e.entry ? 'manuallySettled';


create or replace function public.claim_expense_shopping_source(p_household_id uuid,p_expense_id text,p_amount bigint,p_source jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
#variable_conflict use_variable
declare
  kind text := p_source->>'type'; list_id text := p_source->>'shoppingListId'; item_id text;
  list_record public.shopping_lists; item_record public.shopping_items;
  known_sum bigint; allocated bigint; claimed_total bigint; price numeric; ids jsonb; result jsonb;
begin
  if p_source is null or p_source='null'::jsonb then return null; end if;
  if kind is null or kind not in ('shopping-item','shopping-list') or nullif(list_id,'') is null
     or (p_source ? 'householdId' and p_source->>'householdId' <> p_household_id::text) then raise exception 'Invalid shopping source'; end if;
  select * into list_record from public.shopping_lists where id=list_id and household_id=p_household_id for update;
  if not found then raise exception 'Shopping list must belong to this household'; end if;
  if exists(select 1 from public.expense_shopping_claims c where c.household_id=p_household_id and c.source_kind='shopping-list' and c.source_id=list_id) then raise exception 'This shopping list has already been converted; create a new list for another purchase'; end if;
  result := jsonb_build_object('type',kind,'householdId',p_household_id,'shoppingListId',list_id,'shoppingListName',list_record.name);
  if kind='shopping-item' then
    if jsonb_typeof(p_source->'shoppingItemIds') is distinct from 'array' or jsonb_array_length(p_source->'shoppingItemIds') <> 1 then raise exception 'An item conversion needs exactly one item'; end if;
    item_id := p_source #>> '{shoppingItemIds,0}';
    select * into item_record from public.shopping_items where id=item_id and household_id=p_household_id and shopping_items.list_id=list_id for update;
    if not found then raise exception 'Shopping item must belong to this household and list'; end if;
    if exists(select 1 from public.expense_shopping_claims c where c.household_id=p_household_id and c.source_kind=kind and c.source_id=item_id) then raise exception 'This shopping item has already been converted'; end if;
    if jsonb_typeof(item_record.entry->'price')='number' then
      price := round((item_record.entry->>'price')::numeric*100);
      if price < 0 or price > 9007199254740991 or price <> p_amount then raise exception 'Expense amount must match the stored shopping item price'; end if;
    end if;
    result := result || jsonb_build_object('shoppingItemIds',jsonb_build_array(item_id),'shoppingItemName',item_record.name);
    insert into public.expense_shopping_claims(household_id,source_kind,source_id,list_id,expense_id,amount_cents) values(p_household_id,kind,item_id,list_id,p_expense_id,p_amount);
    -- Commit the source link with the IOU, including outbox retries/restarts;
    -- purchase completion is a separate fact and must remain unchanged.
    update public.shopping_items i set entry=i.entry || jsonb_build_object('convertedExpenseId',p_expense_id) where i.id=item_id and i.household_id=p_household_id;
  else
    select coalesce(sum(case when jsonb_typeof(entry->'price')='number' then greatest(0,round((entry->>'price')::numeric*100)) else 0 end),0),
      coalesce(jsonb_agg(id order by sort_order,id),'[]') into known_sum,ids from public.shopping_items where household_id=p_household_id and shopping_items.list_id=list_id;
    select coalesce(sum(amount_cents),0) into allocated from public.expense_shopping_claims c where c.household_id=p_household_id and c.list_id=list_id and c.source_kind='shopping-item';
    claimed_total := coalesce((p_source->>'listTotalCents')::bigint,known_sum);
    if claimed_total < known_sum or claimed_total > 9007199254740991 or claimed_total-allocated <> p_amount then raise exception 'List total must cover stored prices and expense must equal total minus durable individual claims'; end if;
    result := result || jsonb_build_object('shoppingItemIds',ids,'listTotalCents',claimed_total,'individuallyAllocatedCents',allocated);
    insert into public.expense_shopping_claims(household_id,source_kind,source_id,list_id,expense_id,amount_cents) values(p_household_id,kind,list_id,list_id,p_expense_id,p_amount);
  end if;
  return result;
end $$;
revoke all on function public.claim_expense_shopping_source(uuid,text,bigint,jsonb) from public,anon,authenticated;

create or replace function public.mutate_expense(
  p_household_id uuid,p_operation_id uuid,p_action text,p_expense_id text,
  p_payload jsonb default '{}'::jsonb,p_expected_version bigint default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
#variable_conflict use_variable
declare
  actor uuid := auth.uid(); old_row public.expenses; new_row public.expenses; existing_receipt public.expense_operation_receipts;
  entry jsonb; request jsonb; result_response jsonb; financial_changed boolean; manager boolean; manual boolean; has_payment boolean;
  source jsonb; now_text text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if actor is null or p_operation_id is null or nullif(btrim(p_expense_id),'') is null or length(p_expense_id)>240 then raise exception 'Authentication, operation ID and expense ID are required'; end if;
  if p_action is null or p_action not in ('create','update','repay','settle','delete','reopen','undo_repay') or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid expense operation'; end if;
  if p_payload ? '_expectedActorId' and p_payload->>'_expectedActorId' is distinct from actor::text then raise exception 'Expense account changed; retry from the original account' using errcode='42501'; end if;
  p_payload := p_payload-'_expectedActorId';
  -- Existing rows are locked before the household, matching BEFORE UPDATE
  -- legacy trigger order. Early membership checks prevent foreign-row locks.
  if not exists(select 1 from public.household_members where household_id=p_household_id and user_id=actor and status='active') then raise exception 'Active household membership required' using errcode='42501'; end if;
  select * into old_row from public.expenses where id=p_expense_id and household_id=p_household_id for update;
  perform 1 from public.households where id=p_household_id for update;
  perform 1 from public.household_members where household_id=p_household_id and user_id=actor and status='active' for share;
  if not found then raise exception 'Active household membership required' using errcode='42501'; end if;
  request := jsonb_build_object('action',p_action,'id',p_expense_id,'payload',p_payload,'expectedVersion',p_expected_version);
  select * into existing_receipt from public.expense_operation_receipts where household_id=p_household_id and operation_id=p_operation_id;
  if found then
    if existing_receipt.actor_id <> actor or existing_receipt.request <> request then raise exception 'Operation ID was already used for a different request'; end if;
    if existing_receipt.response is null then raise exception 'Expense operation is already in progress'; end if;
    -- Receipts identify retries, but their old row is not authoritative after
    -- a peer update/delete. Return the current state, never resurrect a record.
    select * into old_row from public.expenses where id=p_expense_id and household_id=p_household_id;
    if old_row.id is null then return jsonb_build_object('expense',null,'deleted',true,'id',p_expense_id); end if;
    return jsonb_build_object('expense',to_jsonb(old_row),'deleted',false,'id',p_expense_id);
  end if;
  insert into public.expense_operation_receipts(household_id,operation_id,actor_id,request,response) values(p_household_id,p_operation_id,actor,request,null);
  perform set_config('sweetmate.expense_operation',p_operation_id::text,true);
  if old_row.id is null and exists(select 1 from public.expenses where id=p_expense_id) then raise exception 'Expense belongs to another household' using errcode='42501'; end if;
  if p_action='create' then
    if old_row.id is not null or exists(select 1 from public.expense_tombstones where expense_id=p_expense_id) then raise exception 'Expense ID already exists or was deleted' using errcode='23505'; end if;
    if p_payload ? 'creatorId' and p_payload->>'creatorId' <> actor::text then raise exception 'Expense creator must be the authenticated actor'; end if;
    entry := public.canonical_expense_entry(p_household_id,p_expense_id,actor,p_payload || jsonb_build_object('paidBack','{}'::jsonb));
    source := public.claim_expense_shopping_source(p_household_id,p_expense_id,(entry->>'amountCents')::bigint,entry->'shoppingSource');
    entry := (entry-'shoppingSource'-'resolvedAt'-'recurring'-'recurringCustom') || jsonb_build_object('settled',public.expense_is_fully_repaid(entry),'manuallySettled',false,'createdAt',now_text,'updatedAt',now_text);
    if source is not null then entry := entry || jsonb_build_object('shoppingSource',source); end if;
    if (entry->>'settled')::boolean then entry := entry || jsonb_build_object('resolvedAt',now_text); end if;
    insert into public.expenses(id,household_id,paid_by,creator_id,amount_cents,expense_date,settled,entry,created_at,updated_at,version)
      values(p_expense_id,p_household_id,(entry->>'paidBy')::uuid,actor,(entry->>'amountCents')::bigint,(entry->>'date')::date,(entry->>'settled')::boolean,entry,clock_timestamp(),clock_timestamp(),1) returning * into new_row;
  else
    if old_row.id is null then raise exception 'Expense no longer exists' using errcode='P0002'; end if;
    if p_action in ('update','delete','settle','reopen') and (p_expected_version is null or p_expected_version <> old_row.version) then raise exception 'Expense changed; refresh before trying again' using errcode='40001'; end if;
    manager := actor=old_row.paid_by or coalesce(actor=old_row.creator_id,false) or public.is_household_owner(p_household_id,actor);
    entry := public.canonical_expense_entry(p_household_id,p_expense_id,old_row.creator_id,old_row.entry || jsonb_build_object('paidBy',old_row.paid_by,'amountCents',old_row.amount_cents,'date',old_row.expense_date),false);
    manual := coalesce((entry->>'manuallySettled')::boolean,old_row.settled and not public.expense_is_fully_repaid(entry));
    has_payment := exists(select 1 from jsonb_each(entry->'paidBack') where value='true'::jsonb);
    if p_action='delete' then
      if not manager then raise exception 'Only the payer, creator or host may delete an expense' using errcode='42501'; end if;
      insert into public.expense_tombstones(expense_id,household_id,deleted_by,deleted_version) values(p_expense_id,p_household_id,actor,old_row.version+1);
      delete from public.expenses where id=p_expense_id;
      result_response := jsonb_build_object('expense',null,'deleted',true,'id',p_expense_id);
    elsif p_action='update' then
      if actor <> coalesce(old_row.creator_id,old_row.paid_by) then raise exception 'Only the expense creator may edit' using errcode='42501'; end if;
      if (p_payload ? 'id' and p_payload->>'id' <> p_expense_id) or (p_payload ? 'creatorId' and p_payload->>'creatorId' is distinct from old_row.creator_id::text)
        or (p_payload ? 'householdId' and p_payload->>'householdId' <> p_household_id::text) then raise exception 'Expense identity is immutable'; end if;
      if p_payload ? 'shoppingSource' and p_payload->'shoppingSource' is distinct from entry->'shoppingSource' then raise exception 'Shopping source is immutable'; end if;
      new_row.entry := public.canonical_expense_entry(p_household_id,p_expense_id,old_row.creator_id,entry || (p_payload-array['paidBack','settled','manuallySettled','resolvedAt','createdAt','updatedAt','version']),false);
      financial_changed := (new_row.entry->'amountCents',new_row.entry->'paidBy',new_row.entry->'sharedWith',new_row.entry->'allocations',new_row.entry->'date',new_row.entry->'splitMode') is distinct from (entry->'amountCents',entry->'paidBy',entry->'sharedWith',entry->'allocations',entry->'date',entry->'splitMode');
      if financial_changed and (has_payment or old_row.settled or manual) then raise exception 'Financial fields are locked after payment or settlement'; end if;
      if entry ? 'shoppingSource' and new_row.entry->'amountCents' is distinct from entry->'amountCents' then raise exception 'Shopping conversion amount is immutable'; end if;
      if financial_changed then new_row.entry := public.canonical_expense_entry(p_household_id,p_expense_id,old_row.creator_id,new_row.entry,true); end if;
      entry := new_row.entry;
    elsif p_action in ('settle','reopen') then
      if not manager then raise exception 'Only the payer, creator or host may manage settlement' using errcode='42501'; end if;
      manual := p_action='settle';
      if p_action='reopen' then
        insert into public.expense_legacy_correction_barriers(expense_id,household_id,settlement_reopened) values(p_expense_id,p_household_id,true)
          on conflict(expense_id) do update set settlement_reopened=true,updated_at=clock_timestamp();
      end if;
    else
      if actor=old_row.paid_by or not exists(select 1 from jsonb_array_elements(entry->'allocations') a where a->>'participantId'=actor::text and (a->>'amountCents')::bigint>0) then raise exception 'Only your own positive share may be repaid or undone' using errcode='42501'; end if;
      if p_action='undo_repay' and manual then raise exception 'Reopen the manually settled expense before correcting your repayment'; end if;
      if p_action='repay' then entry := jsonb_set(entry,'{paidBack}',(entry->'paidBack') || jsonb_build_object(actor::text,true));
      else
        entry := jsonb_set(entry,'{paidBack}',(entry->'paidBack')-actor::text);
        insert into public.expense_legacy_correction_barriers(expense_id,household_id,repayment_actor_ids) values(p_expense_id,p_household_id,array[actor])
          on conflict(expense_id) do update set repayment_actor_ids=(select array_agg(distinct id) from unnest(expense_legacy_correction_barriers.repayment_actor_ids || array[actor]) id),updated_at=clock_timestamp();
      end if;
    end if;
    if p_action <> 'delete' then
      entry := entry || jsonb_build_object('manuallySettled',manual,'settled',manual or public.expense_is_fully_repaid(entry),'updatedAt',now_text);
      if (entry->>'settled')::boolean then entry := entry || jsonb_build_object('resolvedAt',coalesce(old_row.entry->>'resolvedAt',now_text)); else entry := entry-'resolvedAt'; end if;
      update public.expenses set paid_by=(entry->>'paidBy')::uuid,amount_cents=(entry->>'amountCents')::bigint,expense_date=(entry->>'date')::date,settled=(entry->>'settled')::boolean,entry=entry,updated_at=clock_timestamp(),version=old_row.version+1 where id=p_expense_id returning * into new_row;
    end if;
  end if;
  if result_response is null then result_response := jsonb_build_object('expense',to_jsonb(new_row),'deleted',false,'id',p_expense_id); end if;
  update public.expense_operation_receipts r set response=result_response where r.household_id=p_household_id and r.operation_id=p_operation_id;
  perform set_config('sweetmate.expense_operation','',true);
  return result_response;
end $$;
revoke all on function public.mutate_expense(uuid,uuid,text,text,jsonb,bigint) from public,anon;
grant execute on function public.mutate_expense(uuid,uuid,text,text,jsonb,bigint) to authenticated;

-- This definer helper can only be entered through our trigger. It returns a
-- canonical row, not an operation endpoint. Authenticated clients cannot reserve
-- source claims or bypass authorization by invoking it directly.
create or replace function public.guard_legacy_expense_write(p_operation text,p_old public.expenses,p_new public.expenses)
returns public.expenses language plpgsql security definer set search_path=pg_catalog,public as $$
#variable_conflict use_variable
declare
  actor uuid := auth.uid(); old_entry jsonb; incoming jsonb; merged jsonb; result public.expenses := p_new;
  manager boolean; can_edit boolean; new_paid jsonb; pair record; manual boolean; original public.expenses;
  source jsonb; fresh boolean; has_payment boolean; changing_fields boolean;
begin
  if pg_trigger_depth() <> 1 then raise exception 'Expense guard is trigger-only' using errcode='42501'; end if;
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_operation='DELETE' then raise exception 'Upgrade the app to delete expenses safely' using errcode='42501'; end if;
  if p_operation='INSERT' then
    -- Retain the existing row through ON CONFLICT without taking the household
    -- lock first, or a concurrent RPC could deadlock on the opposite order.
    select * into original from public.expenses where id=p_new.id for update;
  end if;
  perform 1 from public.households where id=p_new.household_id for update;
  perform 1 from public.household_members where household_id=p_new.household_id and user_id=actor and status='active' for share;
  if not found then raise exception 'Active household membership required' using errcode='42501'; end if;
  if exists(select 1 from public.expense_tombstones where expense_id=p_new.id) then raise exception 'Expense was deleted and cannot be recreated' using errcode='23505'; end if;
  if p_operation='INSERT' then
    if original.id is not null then
      if original.household_id <> p_new.household_id then raise exception 'Expense household is immutable'; end if;
      -- ON CONFLICT will run the UPDATE guard against the actual locked row.
      return p_new;
    end if;
    if p_new.created_at < (select enabled_at from public.expense_mutation_cutover where singleton) then raise exception 'Historical cache cannot bootstrap expenses; refresh with the updated app'; end if;
    if p_new.creator_id is distinct from actor then raise exception 'Expense creator must be the authenticated actor'; end if;
    incoming := public.canonical_expense_entry(p_new.household_id,p_new.id,actor,p_new.entry || jsonb_build_object('paidBy',p_new.paid_by,'amountCents',p_new.amount_cents,'date',p_new.expense_date,'paidBack','{}'::jsonb));
    source := public.claim_expense_shopping_source(p_new.household_id,p_new.id,p_new.amount_cents,incoming->'shoppingSource');
    incoming := (incoming-'shoppingSource'-'resolvedAt') || jsonb_build_object('manuallySettled',false,'settled',public.expense_is_fully_repaid(incoming));
    if source is not null then incoming := incoming || jsonb_build_object('shoppingSource',source); end if;
    result.version := 1;
  else
    if p_new.id <> p_old.id or p_new.household_id <> p_old.household_id or p_new.creator_id is distinct from p_old.creator_id or p_new.created_at <> p_old.created_at then raise exception 'Expense identity is immutable'; end if;
    old_entry := public.canonical_expense_entry(p_old.household_id,p_old.id,p_old.creator_id,p_old.entry || jsonb_build_object('paidBy',p_old.paid_by,'amountCents',p_old.amount_cents,'date',p_old.expense_date),false);
    incoming := public.canonical_expense_entry(p_new.household_id,p_new.id,p_new.creator_id,p_new.entry || jsonb_build_object('paidBy',p_new.paid_by,'amountCents',p_new.amount_cents,'date',p_new.expense_date),false);
    manager := actor=p_old.paid_by or coalesce(actor=p_old.creator_id,false) or public.is_household_owner(p_old.household_id,actor);
    can_edit := actor=coalesce(p_old.creator_id,p_old.paid_by);
    fresh := p_new.updated_at >= p_old.updated_at;
    has_payment := exists(select 1 from jsonb_each(old_entry->'paidBack') where value='true'::jsonb);
    changing_fields := (incoming-array['paidBack','settled','manuallySettled','resolvedAt','createdAt','updatedAt','version']) is distinct from (old_entry-array['paidBack','settled','manuallySettled','resolvedAt','createdAt','updatedAt','version']);
    -- A client timestamp cannot prove edit freshness (clock skew and queued
    -- whole snapshots exist). Legacy clients may add payment facts, but all
    -- actual field edits require the versioned RPC. Older unchanged snapshots
    -- are harmless no-ops and never overwrite authoritative fields.
    if (incoming->'amountCents',incoming->'paidBy',incoming->'sharedWith',incoming->'allocations',incoming->'date',incoming->'splitMode') is distinct from (old_entry->'amountCents',old_entry->'paidBy',old_entry->'sharedWith',old_entry->'allocations',old_entry->'date',old_entry->'splitMode') then
      if has_payment or p_old.settled then raise exception 'Financial fields are locked after payment or settlement'; end if;
      raise exception 'Upgrade the app to edit expense financial fields safely' using errcode='42501';
    end if;
    if incoming->'shoppingSource' is distinct from old_entry->'shoppingSource' then raise exception 'Shopping source is immutable'; end if;
    if changing_fields and fresh then
      if not can_edit then raise exception 'Only the expense creator may edit' using errcode='42501'; end if;
      raise exception 'Upgrade the app to edit expenses safely' using errcode='42501';
    end if;
    incoming := (old_entry-array['paidBack','settled','manuallySettled','resolvedAt','createdAt','updatedAt','version']) || jsonb_build_object('paidBack',incoming->'paidBack');
    new_paid := old_entry->'paidBack';
    for pair in select key,value from jsonb_each(incoming->'paidBack') where value='true'::jsonb loop
      if coalesce(old_entry->'paidBack'->pair.key,'false'::jsonb) <> 'true'::jsonb then
        if pair.key <> actor::text then raise exception 'Only your own share may be marked repaid' using errcode='42501'; end if;
        if exists(select 1 from public.expense_legacy_correction_barriers b where b.expense_id=p_old.id and actor=any(b.repayment_actor_ids)) then raise exception 'Use the updated app to record a repayment after a correction' using errcode='42501'; end if;
        new_paid := new_paid || jsonb_build_object(pair.key,true);
      end if;
    end loop;
    manual := coalesce((old_entry->>'manuallySettled')::boolean,p_old.settled and not public.expense_is_fully_repaid(old_entry));
    if p_new.settled and not p_old.settled and not public.expense_is_fully_repaid(incoming || jsonb_build_object('paidBack',new_paid)) then
      if not manager then raise exception 'Only the payer, creator or host may settle an expense' using errcode='42501'; end if;
      if exists(select 1 from public.expense_legacy_correction_barriers b where b.expense_id=p_old.id and b.settlement_reopened) then raise exception 'Use the updated app to settle an expense after reopening' using errcode='42501'; end if;
      manual := true;
    end if;
    incoming := incoming || jsonb_build_object('paidBack',new_paid,'manuallySettled',manual,'settled',p_old.settled or manual or public.expense_is_fully_repaid(incoming || jsonb_build_object('paidBack',new_paid)));
    if new_paid=old_entry->'paidBack' and manual=coalesce((old_entry->>'manuallySettled')::boolean,false) and (incoming->>'settled')::boolean=p_old.settled then
      -- No new fact: skip the SQL UPDATE itself, preventing legacy snapshot
      -- echoes from bumping versions or emitting repeated Realtime events.
      return null;
    end if;
    if p_old.entry ? 'resolvedAt' then incoming := incoming || jsonb_build_object('resolvedAt',p_old.entry->'resolvedAt'); end if;
    result.version := p_old.version+1;
  end if;
  result.updated_at := clock_timestamp();
  result.entry := incoming || jsonb_build_object('createdAt',to_char(result.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',to_char(result.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  result.paid_by := (incoming->>'paidBy')::uuid; result.amount_cents := (incoming->>'amountCents')::bigint;
  result.expense_date := (incoming->>'date')::date; result.settled := (incoming->>'settled')::boolean;
  if result.settled and not result.entry ? 'resolvedAt' then result.entry := result.entry || jsonb_build_object('resolvedAt',result.updated_at); end if;
  return result;
end $$;
revoke all on function public.guard_legacy_expense_write(text,public.expenses,public.expenses) from public,anon;
revoke all on function public.guard_legacy_expense_write(text,public.expenses,public.expenses) from authenticated;

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
create trigger expenses_safe_writes before insert or update or delete on public.expenses for each row execute function public.expense_write_guard();
