-- Private device registration and per-device durable nudge delivery.
create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_token text not null unique check (expo_token ~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$'),
  platform text not null check (platform in ('ios','android')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.push_devices enable row level security;
revoke all on public.push_devices from anon, authenticated;

create function public.register_push_device(p_installation_id uuid, p_token text, p_platform text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' or p_platform not in ('ios','android') then
    raise exception 'Invalid push device';
  end if;
  -- Token/installation possession permits account switching on this device.
  delete from public.push_devices where expo_token = p_token and installation_id <> p_installation_id;
  insert into public.push_devices(installation_id,user_id,expo_token,platform)
  values(p_installation_id,auth.uid(),p_token,p_platform)
  on conflict(installation_id) do update set user_id=auth.uid(),expo_token=p_token,
    platform=p_platform,enabled=true,updated_at=now();
end;
$$;
create function public.unregister_push_device(p_installation_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.push_devices set enabled=false,updated_at=now()
  where installation_id=p_installation_id and user_id=auth.uid();
$$;
revoke all on function public.register_push_device(uuid,text,text), public.unregister_push_device(uuid) from public,anon;
grant execute on function public.register_push_device(uuid,text,text), public.unregister_push_device(uuid) to authenticated;

create table public.nudge_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  nudge_id uuid not null references public.nudges(id) on delete cascade,
  device_id uuid not null references public.push_devices(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  expo_token text not null,
  state text not null default 'pending' check(state in ('pending','receipt','delivered','failed','cancelled')),
  ticket_id text,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  claim_id uuid,
  last_error text,
  created_at timestamptz not null default now(),
  unique(nudge_id,device_id)
);
alter table public.nudge_push_deliveries enable row level security;
revoke all on public.nudge_push_deliveries from anon,authenticated;
create index nudge_push_pending on public.nudge_push_deliveries(next_attempt_at) where state in ('pending','receipt');

create function public.enqueue_nudge_push() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Avoid floods to the same recipient; the in-app nudge still persists.
  if new.to_member_id = new.sent_by or exists (
    select 1 from public.nudges n where n.id <> new.id and n.to_member_id=new.to_member_id
    and n.sent_at > now()-interval '1 minute'
  ) then return new; end if;
  insert into public.nudge_push_deliveries(nudge_id,device_id,recipient_id,expo_token)
  select new.id,d.id,new.to_member_id,d.expo_token from public.push_devices d
  where d.user_id=new.to_member_id and d.enabled;
  return new;
end;
$$;
revoke all on function public.enqueue_nudge_push() from public,anon,authenticated;
create trigger enqueue_nudge_push after insert on public.nudges for each row execute function public.enqueue_nudge_push();

create function public.claim_nudge_push_deliveries() returns setof public.nudge_push_deliveries
language plpgsql security definer set search_path = '' as $$
begin
  update public.nudge_push_deliveries q set state='cancelled',claim_id=null,locked_until=null
  where q.state in ('pending','receipt') and (
    q.created_at < now()-interval '24 hours' or q.attempts >= 30 or not exists (
      select 1 from public.push_devices d join public.nudges n on n.id=q.nudge_id
      join public.household_members m on m.household_id=n.household_id and m.user_id=q.recipient_id and m.status='active'
      where d.id=q.device_id and d.enabled and d.user_id=q.recipient_id and d.expo_token=q.expo_token
      and n.to_member_id=q.recipient_id and n.dismissed_at is null
    )
  );
  return query update public.nudge_push_deliveries q set
    claim_id=gen_random_uuid(),locked_until=now()+interval '3 minutes',attempts=attempts+1
  where q.id in (
    select id from public.nudge_push_deliveries where state in ('pending','receipt')
    and next_attempt_at <= now() and (locked_until is null or locked_until < now())
    order by next_attempt_at for update skip locked limit 50
  ) returning q.*;
end;
$$;
revoke all on function public.claim_nudge_push_deliveries() from public,anon,authenticated;
grant execute on function public.claim_nudge_push_deliveries() to service_role;
