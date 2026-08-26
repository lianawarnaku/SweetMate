-- Phase 1 of household-timezone support (see docs/chore-system-audit.md #8):
-- capture the household's IANA timezone at creation time and store it.
-- This migration only adds storage and the onboarding capture path. Chore/
-- expense/calendar date math still uses each device's local clock; wiring
-- the stored timezone into that logic is a separate, larger follow-up.
alter table public.households
  add column if not exists timezone text not null default 'UTC';

-- An old, unused three-argument overload of create_household (predating
-- client-visible invite codes) was still sitting alongside the current
-- four-argument version. Nothing in the current app calls it; dropping it
-- before adding a fifth argument avoids a third overload accumulating.
drop function if exists public.create_household(text, text, text);

create or replace function public.create_household(
  household_name text,
  member_name text,
  member_color text,
  requested_invite_code text,
  household_timezone text default 'UTC'
) returns table(household_id uuid, invite_code text)
language plpgsql security definer set search_path = public
as $$
declare
  new_id uuid;
  new_code text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  new_code := upper(trim(requested_invite_code));
  if new_code !~ '^[A-Z0-9]{8}$' then
    raise exception 'Invite code must be eight letters or numbers';
  end if;
  insert into households(name, invite_code, created_by, timezone)
    values (
      trim(household_name),
      new_code,
      auth.uid(),
      coalesce(nullif(trim(household_timezone), ''), 'UTC')
    )
    returning id into new_id;
  insert into household_members(
    household_id, user_id, display_name, color, role, status
  ) values (
    new_id, auth.uid(), trim(member_name), member_color, 'owner', 'active'
  );
  return query select new_id, new_code;
end;
$$;

grant execute on function public.create_household(text, text, text, text, text) to authenticated;
