-- Remove cached participant names as well as IDs from shared borrowing.
begin;
create or replace function public.scrub_deleted_members(p_household uuid,p_value jsonb)
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
    if profile_alias is null then
      select id::text into profile_alias from public.deleted_member_aliases
      where household_id=p_household and id::text=coalesce(p_value->>'id',p_value->>'user_id');
    end if;
    if profile_alias is not null and (p_value ? 'name' or p_value ? 'display_name' or p_value ? 'avatarUri') then
      result:=jsonb_build_object('id',profile_alias,'name','Deleted member','display_name','Deleted member','color','#808080','points',0,'weeklyPoints',0);
    end if;
    -- Borrow records cache display names as well as participant IDs. Scrub
    -- both original and already-anonymized references, including stale writes.
    if public.deleted_member_alias(p_household,p_value->>'borrowedFrom') is not null
      or exists(select 1 from public.deleted_member_aliases where household_id=p_household and id::text=p_value->>'borrowedFrom') then
      result:=result||jsonb_build_object('ownerName','Deleted member');
    end if;
    if public.deleted_member_alias(p_household,p_value->>'borrowedBy') is not null
      or exists(select 1 from public.deleted_member_aliases where household_id=p_household and id::text=p_value->>'borrowedBy') then
      result:=result||jsonb_build_object('borrowerName','Deleted member');
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
commit;
