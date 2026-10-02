-- The row is also the durable notification outbox. No feedback is discarded
-- when email delivery fails. Contact data is only readable by administrators.
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  category text not null check (category in ('suggestion', 'bug', 'other')),
  message text not null check (char_length(message) between 1 and 1500 and message ~ '[^[:space:]]'),
  contact_email text check (contact_email is null or (
    char_length(contact_email) <= 254 and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  )),
  created_at timestamptz not null default now(),
  app_version text check (char_length(app_version) <= 64),
  platform text check (platform in ('web', 'ios', 'android', 'other')),
  status text not null default 'new' check (status in ('new', 'reviewed', 'closed')),
  notification_sent_at timestamptz,
  notification_attempts integer not null default 0,
  notification_next_attempt_at timestamptz not null default now(),
  notification_locked_until timestamptz,
  notification_claim_id uuid,
  notification_error text,
  unique (user_id, request_id)
);
create index feedback_user_created_idx on public.feedback(user_id, created_at desc);
create index feedback_pending_notification_idx on public.feedback(notification_next_attempt_at)
  where notification_sent_at is null;
alter table public.feedback enable row level security;
revoke all on public.feedback from public, anon, authenticated;
grant insert (request_id, category, message, contact_email, app_version, platform)
  on public.feedback to authenticated;
grant all on public.feedback to service_role;
create policy "authenticated users submit their own feedback" on public.feedback
  for insert to authenticated with check (user_id = (select auth.uid()));
-- No SELECT, UPDATE or DELETE policies for app users, even for their own rows.

-- Applies to direct inserts as well as the RPC. Serializes submissions per user
-- so concurrent calls cannot bypass the five-submissions-per-hour quota.
create function public.guard_feedback_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or new.user_id is distinct from auth.uid() then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  if (select count(*) from public.feedback
      where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Feedback rate limit reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_feedback_insert() from public, anon, authenticated;
create trigger feedback_insert_guard before insert on public.feedback
  for each row execute function public.guard_feedback_insert();

-- A narrow insert operation returns a receipt without granting table reads.
-- User identity, timestamps and workflow fields never come from request data.
create function public.submit_feedback(
  p_request_id uuid, p_category text, p_message text, p_contact_email text,
  p_app_version text, p_platform text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare existing public.feedback; result_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  select * into existing from public.feedback
    where user_id = auth.uid() and request_id = p_request_id;
  if found then
    if existing.category is distinct from p_category
      or existing.message is distinct from p_message
      or existing.contact_email is distinct from p_contact_email
      or existing.app_version is distinct from p_app_version
      or existing.platform is distinct from p_platform then
      raise exception 'Request already used' using errcode = '22023';
    end if;
    return existing.id;
  end if;
  insert into public.feedback(request_id, user_id, category, message, contact_email, app_version, platform)
  values (p_request_id, auth.uid(), p_category, p_message, p_contact_email, p_app_version, p_platform)
  returning id into result_id;
  return result_id;
end;
$$;
revoke all on function public.submit_feedback(uuid,text,text,text,text,text) from public, anon;
grant execute on function public.submit_feedback(uuid,text,text,text,text,text) to authenticated;

-- Lease a small batch; overlapping immediate sends/cron runs cannot double-claim.
create function public.claim_feedback_notifications(p_id uuid default null)
returns setof public.feedback language sql security definer set search_path = '' as $$
  update public.feedback f set
    notification_claim_id = gen_random_uuid(),
    notification_locked_until = now() + interval '5 minutes',
    notification_attempts = notification_attempts + 1
  where f.id in (
    select id from public.feedback
    where notification_sent_at is null
      and notification_next_attempt_at <= now()
      and (notification_locked_until is null or notification_locked_until < now())
      and (p_id is null or id = p_id)
    order by created_at for update skip locked limit 10
  ) returning f.*;
$$;
revoke all on function public.claim_feedback_notifications(uuid) from public, anon, authenticated;
grant execute on function public.claim_feedback_notifications(uuid) to service_role;
