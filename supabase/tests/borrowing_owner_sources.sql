begin;
do $$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  hid uuid:=gen_random_uuid(); other_home uuid:=gen_random_uuid(); private_id uuid:=gen_random_uuid();
  self_record jsonb; external_record jsonb; denied boolean; record_id text:='outside-'||gen_random_uuid()::text;
begin
  insert into auth.users(id,email) values(a,a::text||'@borrow-test.invalid'),(b,b::text||'@borrow-test.invalid'),(outsider,outsider::text||'@borrow-test.invalid');
  insert into public.households(id,name,invite_code,created_by) values(hid,'Borrow regression',hid::text,a),(other_home,'Other home',other_home::text,outsider);
  insert into public.household_members(household_id,user_id,display_name,role,status) values(hid,a,'Avery','owner','active'),(hid,b,'Blake','member','active'),(other_home,outsider,'Outsider','owner','active');
  perform set_config('request.jwt.claim.sub',a::text,true);
  self_record:=jsonb_build_object('id',gen_random_uuid(),'householdId',hid,'creatorId',a,'ownerId',a,'borrowedFrom',a,'borrowedBy',a,'item','Self borrowing','visibility','shared','borrowedAt',now(),'dueDate',now()+interval '7 days','returned',false);
  -- This exercises the final function after EVERY migration, including the
  -- August migration that accidentally reinstated the same-person rejection.
  insert into public.household_states(household_key,household_id,state,updated_by) values(hid::text,hid,jsonb_build_object('borrowItems',jsonb_build_array(self_record)),a);
  external_record:=self_record||jsonb_build_object('id',record_id,'borrowedFrom','other','externalOwnerName','Alex at work','ownerName','Alex at work','borrowedBy',b);
  update public.household_states set state=jsonb_build_object('borrowItems',jsonb_build_array(self_record,external_record)),updated_by=a where household_id=hid;
  insert into public.shared_borrow_items(id,household_id,creator_id,owner_id,borrowed_from,borrowed_by,due_date,entry) values(record_id,hid,a,a,null,b,now()+interval '7 days',external_record);
  if (select entry->>'externalOwnerName' from public.shared_borrow_items where id=record_id)<>'Alex at work' then raise exception 'Outside owner name did not persist'; end if;
  denied:=false;
  begin
    insert into public.shared_borrow_items(id,household_id,borrowed_from,borrowed_by,due_date,entry) values('invalid-'||record_id,hid,null,b,now(),external_record-'externalOwnerName');
  exception when check_violation then denied:=true;
  end;
  if not denied then raise exception 'Unnamed Other owner was accepted'; end if;
  denied:=false;
  begin
    update public.household_states set state=jsonb_build_object('borrowItems',jsonb_build_array(external_record||jsonb_build_object('borrowedBy',outsider))) where household_id=hid;
  exception when raise_exception then
    if sqlerrm not like '%active household members%' then raise; end if;
    denied:=true;
  end;
  if not denied then raise exception 'An external owner allowed an outsider borrower'; end if;
  insert into public.private_borrow_items(id,household_id,owner_id,entry) values(private_id,hid,a,external_record||jsonb_build_object('id',private_id,'visibility','private'));
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub',b::text,true);
  if not exists(select 1 from public.shared_borrow_items where id=record_id) then raise exception 'Member could not read shared outside owner'; end if;
  if exists(select 1 from public.private_borrow_items where id=private_id) then raise exception 'Outside owner exposed a private record to a roommate'; end if;
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  if exists(select 1 from public.shared_borrow_items where id=record_id) then raise exception 'Outside owner exposed a household to an outsider'; end if;
  execute 'reset role';
  -- Replacing the legacy trigger must retain the deletion maintenance guard.
  if position('account_deletion_transactions' in pg_get_functiondef('public.validate_household_borrow_transactions()'::regprocedure))=0 then raise exception 'Account-deletion guard was removed'; end if;
  perform public.finalize_account_deletion(a);
  if not exists(select 1 from public.shared_borrow_items where id=record_id and entry->>'externalOwnerName'='Alex at work') then raise exception 'Creator deletion removed the remaining household shared record'; end if;
  if exists(select 1 from public.private_borrow_items where id=private_id) then raise exception 'Creator deletion retained a private outside-owner record'; end if;
end $$;
rollback;
