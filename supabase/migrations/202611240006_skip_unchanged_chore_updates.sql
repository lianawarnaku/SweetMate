begin;
-- Supabase echoes can contain the same values in a different JSON key order.
-- An unchanged row must not create another UPDATE event for every roommate.
-- Run after the existing policy/identity/retirement guards so real changes
-- those guards make still persist and legacy-write checks remain enforced.
create function public.skip_unchanged_chore_updates()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if new is not distinct from old then return null; end if;
  return new;
end;
$$;
revoke all on function public.skip_unchanged_chore_updates() from public,anon,authenticated;
create trigger zz_skip_unchanged_chore_updates before update on public.chores
  for each row execute function public.skip_unchanged_chore_updates();
commit;
