-- Realtime authorizes UPDATE delivery against the new row. Without this own-row
-- policy, changing status to removed/left also hides the very event that tells
-- the former member to stop displaying cached household data. This exposes only
-- their own membership metadata, never household contents or another member.
drop policy if exists "users read own membership status" on public.household_members;
create policy "users read own membership status" on public.household_members
  for select to authenticated using (user_id = (select auth.uid()));
