-- Keep self-borrowing valid after the August owner-helper migration, and
-- represent an outside owner by a name rather than a fabricated account UUID.
-- No existing records, ownership, memberships, or RLS policies are changed.
alter table public.shared_borrow_items alter column borrowed_from drop not null;
alter table public.shared_borrow_items
  add constraint shared_borrow_owner_source check (
    borrowed_from is not null or coalesce(
      entry ->> 'borrowedFrom' = 'other'
      and char_length(btrim(entry ->> 'externalOwnerName')) between 1 and 100,
      false
    )
  );

create or replace function public.validate_household_borrow_transactions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  record jsonb;
  old_record jsonb;
  previous_record jsonb;
  owner_id uuid;
  borrower_id uuid;
  creator_id uuid;
  is_new_record boolean;
  is_host boolean;
  is_involved boolean;
begin
  -- Preserve the service-only account-deletion maintenance branch installed in November.
  if exists(select 1 from public.account_deletion_transactions where transaction_id=txid_current()) then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  is_host := public.is_household_owner(new.household_id, new.updated_by);

  for record in
    select value
    from jsonb_array_elements(coalesce(new.state -> 'borrowItems', '[]'::jsonb))
  loop
    previous_record := null;
    if tg_op = 'UPDATE' then
      select value into previous_record
      from jsonb_array_elements(coalesce(old.state -> 'borrowItems', '[]'::jsonb))
      where value ->> 'id' = record ->> 'id'
      limit 1;
    end if;
    if previous_record = record then
      continue;
    end if;

    if previous_record is not null then
      is_involved := new.updated_by in (
        nullif(nullif(previous_record ->> 'borrowedFrom', 'other'), '')::uuid,
        nullif(previous_record ->> 'borrowedBy', '')::uuid
      );
      if not is_host
        and new.updated_by is distinct from nullif(previous_record ->> 'creatorId', '')::uuid
        and not (
          is_involved
          and (record - array['returned', 'returnedAt', 'returnRequestedAt', 'returnConfirmedBy', 'updatedAt'])
            = (previous_record - array['returned', 'returnedAt', 'returnRequestedAt', 'returnConfirmedBy', 'updatedAt'])
        )
        and not (
          nullif(previous_record ->> 'creatorId', '') is null and is_involved
        )
      then
        raise exception 'Only the creator or household host may edit a borrow transaction';
      end if;
    end if;

    -- Unchanged legacy records predate identity metadata. New records may not
    -- omit creatorId to disguise themselves as legacy data.
    if nullif(record ->> 'creatorId', '') is null then
      if previous_record is not null then
        continue;
      end if;
      raise exception 'Borrow transaction creator is required';
    end if;

    owner_id := nullif(nullif(record ->> 'borrowedFrom', 'other'), '')::uuid;
    borrower_id := nullif(record ->> 'borrowedBy', '')::uuid;
    creator_id := nullif(record ->> 'creatorId', '')::uuid;
    is_new_record := previous_record is null;

    -- Self-borrowing is valid. Only the explicit Other owner lacks a user UUID.
    if borrower_id is null or (owner_id is null and record ->> 'borrowedFrom' is distinct from 'other') then
      raise exception 'Borrow owner and borrower must be active members, or name an Other owner';
    end if;
    if record ->> 'borrowedFrom' = 'other' and not coalesce(
      char_length(btrim(record ->> 'externalOwnerName')) between 1 and 100, false
    ) then
      raise exception 'Other borrowing owners need a name from 1 to 100 characters';
    end if;
    if nullif(record ->> 'householdId', '')::uuid is distinct from new.household_id then
      raise exception 'Borrow transaction belongs to a different household';
    end if;
    if (owner_id is not null and not exists (
      select 1 from public.household_members
      where household_id = new.household_id and user_id = owner_id and status = 'active'
    )) or not exists (
      select 1 from public.household_members
      where household_id = new.household_id and user_id = borrower_id and status = 'active'
    ) then
      raise exception 'Borrow owner and borrower must be active household members';
    end if;
    if is_new_record and (
      creator_id is distinct from new.updated_by or not exists (
        select 1 from public.household_members
        where household_id = new.household_id and user_id = creator_id and status = 'active'
      )
    ) then
      raise exception 'Borrow transaction creator must be the authenticated household member';
    end if;
  end loop;

  if tg_op = 'UPDATE' then
    for old_record in
      select historical.value
      from jsonb_array_elements(coalesce(old.state -> 'borrowItems', '[]'::jsonb)) as historical(value)
      where not exists (
        select 1
        from jsonb_array_elements(coalesce(new.state -> 'borrowItems', '[]'::jsonb)) as current(value)
        where current.value ->> 'id' = historical.value ->> 'id'
      )
    loop
      is_involved := new.updated_by in (
        nullif(nullif(old_record ->> 'borrowedFrom', 'other'), '')::uuid,
        nullif(old_record ->> 'borrowedBy', '')::uuid
      );
      if not is_host
        and new.updated_by is distinct from nullif(old_record ->> 'creatorId', '')::uuid
        and not (nullif(old_record ->> 'creatorId', '') is null and is_involved)
      then
        raise exception 'Only the creator or household host may delete a borrow transaction';
      end if;
    end loop;
  end if;
  return new;
end;
$$;
