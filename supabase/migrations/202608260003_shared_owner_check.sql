-- validate_household_borrow_transactions computed "is this the household
-- owner" with its own inline query, independent of the app's JavaScript
-- isHost logic and independent of every other place in this schema that
-- answers the same question. is_household_member() already established the
-- pattern of a single shared helper for membership checks; this does the
-- same for ownership, starting with this one trigger.
--
-- The inline check also didn't filter status = 'active', unlike the app's
-- own isHost (which is only ever derived from an active membership row) —
-- a former owner who left or was removed but still has an 'owner'-tagged
-- row would have been treated as the host by this trigger. The shared
-- helper fixes that too.
create or replace function public.is_household_owner(hid uuid, member_user_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid
      and user_id = member_user_id
      and role = 'owner'
      and status = 'active'
  );
$$;

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
        nullif(previous_record ->> 'borrowedFrom', '')::uuid,
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

    owner_id := nullif(record ->> 'borrowedFrom', '')::uuid;
    borrower_id := nullif(record ->> 'borrowedBy', '')::uuid;
    creator_id := nullif(record ->> 'creatorId', '')::uuid;
    is_new_record := previous_record is null;

    if owner_id is null or borrower_id is null or owner_id = borrower_id then
      raise exception 'Borrow owner and borrower must be different active members';
    end if;
    if nullif(record ->> 'householdId', '')::uuid is distinct from new.household_id then
      raise exception 'Borrow transaction belongs to a different household';
    end if;
    if not exists (
      select 1 from public.household_members
      where household_id = new.household_id and user_id = owner_id
    ) or not exists (
      select 1 from public.household_members
      where household_id = new.household_id and user_id = borrower_id
    ) then
      raise exception 'Borrow owner and borrower must be active household members';
    end if;
    if is_new_record and (
      creator_id is distinct from new.updated_by or not exists (
        select 1 from public.household_members
        where household_id = new.household_id and user_id = creator_id
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
        nullif(old_record ->> 'borrowedFrom', '')::uuid,
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

-- Other inline `role = 'owner'` checks exist elsewhere in this schema
-- (delete_household, chart approval overrides, account/membership
-- management). Those weren't touched here — they weren't the ones asked
-- about, and several have slightly different semantics (checking against
-- auth.uid() directly, or as part of a larger membership-count decision)
-- that deserve individual review rather than a blanket find-and-replace.
