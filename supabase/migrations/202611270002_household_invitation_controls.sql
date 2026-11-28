begin;

alter table public.households add column invitations_enabled boolean not null default true;
alter table public.household_members add column removal_version bigint not null default 0;
alter table public.household_members add column removed_at timestamptz;
update public.household_members set removal_version=1,removed_at=clock_timestamp() where status='removed';
-- Removed identities cannot rename their frozen membership to mislead a host.
drop policy if exists "users can update own membership" on public.household_members;
create policy "users can update own membership" on public.household_members for update to authenticated
  using(user_id=auth.uid() and status='active') with check(user_id=auth.uid() and status='active');
-- Clients submit a digest; store a second verifier, so a database hash alone
-- cannot be replayed as an invitation. Raw personal codes never reach storage.
create function public._invitation_verifier(proof text) returns text language sql immutable strict set search_path=pg_catalog as $$ select encode(sha256(convert_to(proof,'UTF8')),'hex') $$;
revoke all on function public._invitation_verifier(text) from public,anon,authenticated;

alter table public.households add column invite_digest text;
update public.households set invite_digest=public._invitation_verifier(encode(sha256(convert_to(invite_code,'UTF8')),'hex'));
create function public._sync_household_invite_digest() returns trigger language plpgsql set search_path=pg_catalog as $$
begin new.invite_digest:=public._invitation_verifier(encode(sha256(convert_to(new.invite_code,'UTF8')),'hex')); return new; end $$;
revoke all on function public._sync_household_invite_digest() from public,anon,authenticated;
create trigger sync_household_invite_digest before insert or update of invite_code,invite_digest on public.households for each row execute function public._sync_household_invite_digest();
create unique index households_invitation_digest on public.households(invite_digest);

create table public.household_reinvitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  invited_user_id uuid not null references auth.users(id) on delete cascade,
  removal_version bigint not null,
  created_by uuid references auth.users(id) on delete set null,
  token_hash text unique check(token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  token_suffix text check(token_suffix is null or token_suffix ~ '^[A-F0-9]{4}$'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '7 days',
  revoked_at timestamptz,
  used_at timestamptz,
  check((token_hash is null)=(token_suffix is null))
);
create index household_reinvitations_active on public.household_reinvitations(household_id,invited_user_id) where revoked_at is null and used_at is null;
alter table public.household_reinvitations enable row level security;
revoke all on public.household_reinvitations from public,anon,authenticated;

-- Per-account counters only. No IP addresses, IP hashes, or location data.
create table public.household_invitation_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  window_start timestamptz not null,
  window_seconds integer not null,
  attempts integer not null,
  primary key(user_id,action,window_start,window_seconds)
);
alter table public.household_invitation_limits enable row level security;
revoke all on public.household_invitation_limits from public,anon,authenticated;

create function public._household_invitation_budget(action_name text)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare span integer; cap integer; used integer; start_at timestamptz; wait_seconds integer:=0; actor uuid:=auth.uid(); moment timestamptz:=clock_timestamp();
begin
  if actor is null then raise exception 'Sign in first' using errcode='42501'; end if;
  delete from public.household_invitation_limits l where l.user_id=actor and l.window_start<moment-interval '2 days';
  foreach span in array case when action_name='join' then array[900,86400] else array[3600,86400] end loop
    cap:=case when action_name='join' and span=900 then 10 when action_name='join' then 30 when span=3600 then 30 else 100 end;
    start_at:=to_timestamp(floor(extract(epoch from moment)/span)*span);
    insert into public.household_invitation_limits as l(user_id,action,window_start,window_seconds,attempts)
      values(actor,action_name,start_at,span,1)
      on conflict(user_id,action,window_start,window_seconds) do update set attempts=least(l.attempts+1,cap+1)
      returning attempts into used;
    if used>cap then wait_seconds:=greatest(wait_seconds,ceil(extract(epoch from start_at+make_interval(secs=>span)-moment))::integer); end if;
  end loop;
  return wait_seconds;
end $$;
revoke all on function public._household_invitation_budget(text) from public,anon,authenticated;

-- Return expected denials normally so failed-attempt counters COMMIT. Raising
-- an exception here would undo the very counter intended to stop guessing.
create function public.redeem_household_invite(invitation_hash text,member_name text,member_color text default '#7B563B')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); target uuid; grant_row public.household_reinvitations; existing public.household_members;
  delay integer; denied jsonb:=jsonb_build_object('ok',false,'code','INVITE_UNAVAILABLE','message','That invitation is unavailable. Ask the host for a new invitation or approval.');
begin
  if actor is null then raise exception 'Sign in before joining' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('household-admission:'||actor::text,0));
  delay:=public._household_invitation_budget('join');
  if delay>0 then return jsonb_build_object('ok',false,'code','RATE_LIMITED','message','Too many join attempts. Please try again later.','retry_after_seconds',delay); end if;
  if not exists(select 1 from auth.users where id=actor and (email_confirmed_at is not null or phone_confirmed_at is not null)) then
    return jsonb_build_object('ok',false,'code','VERIFY_ACCOUNT','message','Verify your email before joining a household.'); end if;
  if invitation_hash is null or invitation_hash !~ '^[0-9a-f]{64}$' then return denied; end if;
  if member_name is null or length(btrim(member_name)) not between 1 and 60 or member_color is null or member_color !~ '^#[0-9a-fA-F]{6}$' then
    return jsonb_build_object('ok',false,'code','INVALID_PROFILE','message','Enter a name of 1 to 60 characters and choose a profile color.'); end if;
  select h.id into target from public.households h where h.invitations_enabled and h.invite_digest=public._invitation_verifier(invitation_hash);
  if target is null then
    select * into grant_row from public.household_reinvitations g where g.token_hash=public._invitation_verifier(invitation_hash) and g.invited_user_id=actor;
    target:=grant_row.household_id;
  end if;
  if target is null then return denied; end if;
  perform 1 from public.households h where h.id=target and h.invitations_enabled for update;
  if not found then return denied; end if;
  -- A rotation/revocation may have won while this request waited for the lock.
  if grant_row.id is null and not exists(select 1 from public.households h where h.id=target and h.invite_digest=public._invitation_verifier(invitation_hash)) then return denied; end if;
  select * into existing from public.household_members m where m.household_id=target and m.user_id=actor;
  if grant_row.id is not null then
    select * into grant_row from public.household_reinvitations g where g.id=grant_row.id for update;
    if grant_row.revoked_at is not null or grant_row.expires_at<=clock_timestamp() or grant_row.removal_version<>coalesce(existing.removal_version,0) then return denied; end if;
    if grant_row.used_at is not null and existing.status is distinct from 'active' then return denied; end if;
  elsif existing.status='removed' then
    select * into grant_row from public.household_reinvitations g where g.household_id=target and g.invited_user_id=actor
      and g.token_hash is null and g.removal_version=existing.removal_version and g.revoked_at is null and g.used_at is null and g.expires_at>clock_timestamp()
      order by g.created_at desc,g.id desc limit 1 for update;
    if not found then return denied; end if;
  end if;
  if grant_row.id is not null and not exists(select 1 from public.household_members issuer where issuer.household_id=target and issuer.user_id=grant_row.created_by and issuer.role='owner' and issuer.status='active') then return denied; end if;
  if existing.status='active' then return jsonb_build_object('ok',true,'household_id',target); end if;
  if (select count(*) from public.household_members where user_id=actor and status='active')>=20
    or (select count(*) from public.household_members where household_id=target and status='active')>=50 then
    return jsonb_build_object('ok',false,'code','MEMBERSHIP_LIMIT','message','This account or household has reached its membership limit.'); end if;
  if grant_row.id is not null then update public.household_reinvitations set used_at=clock_timestamp() where id=grant_row.id; end if;
  insert into public.household_members as m(household_id,user_id,display_name,color,role,status)
    values(target,actor,btrim(member_name),member_color,'member','active')
    on conflict(household_id,user_id) do update set display_name=excluded.display_name,color=excluded.color,status='active',role='member',joined_at=clock_timestamp();
  return jsonb_build_object('ok',true,'household_id',target);
end $$;
revoke all on function public.redeem_household_invite(text,text,text) from public,anon;
grant execute on function public.redeem_household_invite(text,text,text) to authenticated;

-- Installed clients keep their UUID success response and use the same gates.
-- A non-throwing denial preserves counters even through this legacy endpoint.
create or replace function public.join_household(code text,member_name text,member_color text default '#7B563B')
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  result:=public.redeem_household_invite(encode(sha256(convert_to(upper(btrim(coalesce(code,''))),'UTF8')),'hex'),member_name,member_color);
  if result->>'ok'='true' then return (result->>'household_id')::uuid; end if;
  perform set_config('response.status',case when result->>'code'='RATE_LIMITED' then '429' else '403' end,true);
  return null;
end $$;
revoke all on function public.join_household(text,text,text) from public,anon;
grant execute on function public.join_household(text,text,text) to authenticated;

create or replace function public.remove_household_member(target_household_id uuid,target_user_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform 1 from public.households where id=target_household_id for update;
  if auth.uid() is null or not exists(select 1 from public.household_members where household_id=target_household_id and user_id=auth.uid() and role='owner' and status='active') then
    raise exception 'Only the active household host can remove a member' using errcode='42501'; end if;
  if target_user_id=auth.uid() then raise exception 'Hosts cannot remove themselves'; end if;
  update public.household_members set status='removed',removal_version=removal_version+1,removed_at=clock_timestamp()
    where household_id=target_household_id and user_id=target_user_id and status in ('active','left','invited');
  if not found then raise exception 'That member is already removed or unavailable'; end if;
  update public.household_reinvitations set revoked_at=clock_timestamp() where household_id=target_household_id and revoked_at is null;
  -- Revokes the old shared code too; it can never undo this removal.
  update public.households set invite_code=upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)) where id=target_household_id;
  delete from public.proposed_chart_approvals where household_id=target_household_id and member_id=target_user_id;
  delete from public.member_task_preferences where household_id=target_household_id and member_id=target_user_id;
  update public.proposed_charts set status='cancelled' where household_id=target_household_id and status='pending';
end $$;
revoke all on function public.remove_household_member(uuid,uuid) from public,anon;
grant execute on function public.remove_household_member(uuid,uuid) to authenticated;

create function public.manage_household_invites(target_household_id uuid,invite_action text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare delay integer; fresh text;
begin
  perform 1 from public.households where id=target_household_id for update;
  if auth.uid() is null or not exists(select 1 from public.household_members where household_id=target_household_id and user_id=auth.uid() and role='owner' and status='active') then raise exception 'Only the active household host can manage invitations' using errcode='42501'; end if;
  delay:=case when invite_action='pause' then 0 else public._household_invitation_budget('host') end;
  if delay>0 then return jsonb_build_object('ok',false,'message','Too many invitation changes. Please try again later.'); end if;
  if invite_action is null or invite_action not in ('rotate','pause','resume') then return jsonb_build_object('ok',false,'message','Choose a valid invitation action.'); end if;
  fresh:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
  update public.household_reinvitations set revoked_at=clock_timestamp() where household_id=target_household_id and revoked_at is null;
  update public.households set invite_code=fresh,invitations_enabled=invite_action<>'pause' where id=target_household_id;
  return jsonb_build_object('ok',true,'invite_code',fresh,'enabled',invite_action<>'pause');
end $$;

create function public.create_household_reinvitation(target_household_id uuid,target_user_id uuid,token_hash text default null,token_suffix text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare delay integer; version bigint; result public.household_reinvitations;
begin
  perform 1 from public.households where id=target_household_id and invitations_enabled for update;
  if not found or auth.uid() is null or not exists(select 1 from public.household_members where household_id=target_household_id and user_id=auth.uid() and role='owner' and status='active') then raise exception 'Only the active host can issue an invitation while invitations are enabled' using errcode='42501'; end if;
  delay:=public._household_invitation_budget('host');
  if delay>0 then return jsonb_build_object('ok',false,'message','Too many invitation changes. Please try again later.'); end if;
  select removal_version into version from public.household_members where household_id=target_household_id and user_id=target_user_id and status='removed';
  if not found then return jsonb_build_object('ok',false,'message','This account is not a removed member of this household.'); end if;
  if (token_hash is null)<>(token_suffix is null) or (token_hash is not null and (token_hash !~ '^[0-9a-f]{64}$' or token_suffix !~ '^[A-F0-9]{4}$')) then
    return jsonb_build_object('ok',false,'message','The invitation could not be created. Please try again.'); end if;
  if token_hash is not null then
    select * into result from public.household_reinvitations g where g.token_hash=public._invitation_verifier(create_household_reinvitation.token_hash);
    if found then
      if result.household_id=target_household_id and result.invited_user_id=target_user_id and result.removal_version=version and result.revoked_at is null and result.used_at is null and result.expires_at>clock_timestamp() then
        return jsonb_build_object('ok',true,'id',result.id,'expires_at',result.expires_at);
      end if;
      return jsonb_build_object('ok',false,'message','Create a fresh personal invitation. This one is no longer available.');
    end if;
  else
    select * into result from public.household_reinvitations g where g.household_id=target_household_id and g.invited_user_id=target_user_id and g.removal_version=version and g.token_hash is null and g.revoked_at is null and g.used_at is null and g.expires_at>clock_timestamp() order by g.created_at desc,g.id desc limit 1;
    if found then return jsonb_build_object('ok',true,'id',result.id,'expires_at',result.expires_at); end if;
  end if;
  update public.household_reinvitations set revoked_at=clock_timestamp() where household_id=target_household_id and invited_user_id=target_user_id and revoked_at is null and used_at is null;
  insert into public.household_reinvitations(household_id,invited_user_id,removal_version,created_by,token_hash,token_suffix)
    values(target_household_id,target_user_id,version,auth.uid(),public._invitation_verifier(token_hash),token_suffix) returning * into result;
  return jsonb_build_object('ok',true,'id',result.id,'expires_at',result.expires_at);
end $$;

create function public.revoke_household_reinvitation(target_household_id uuid,invitation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare delay integer;
begin
  perform 1 from public.households where id=target_household_id for update;
  if auth.uid() is null or not exists(select 1 from public.household_members where household_id=target_household_id and user_id=auth.uid() and role='owner' and status='active') then raise exception 'Only the active household host can revoke invitations' using errcode='42501'; end if;
  update public.household_reinvitations set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=invitation_id and household_id=target_household_id;
  return jsonb_build_object('ok',true);
end $$;

create function public.get_household_invitations(target_household_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not exists(select 1 from public.household_members where household_id=target_household_id and user_id=auth.uid() and role='owner' and status='active') then raise exception 'Only the active household host can view invitations' using errcode='42501'; end if;
  return jsonb_build_object('enabled',(select invitations_enabled from public.households where id=target_household_id),
    'removed',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'name',m.display_name) order by m.display_name,m.user_id) from public.household_members m where m.household_id=target_household_id and m.status='removed'),'[]'::jsonb),
    'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'user_id',g.invited_user_id,'expires_at',g.expires_at,'suffix',g.token_suffix,'approval_only',g.token_hash is null) order by g.created_at,g.id) from public.household_reinvitations g where g.household_id=target_household_id and g.revoked_at is null and g.used_at is null and g.expires_at>now()),'[]'::jsonb));
end $$;
revoke all on function public.manage_household_invites(uuid,text),public.create_household_reinvitation(uuid,uuid,text,text),public.revoke_household_reinvitation(uuid,uuid),public.get_household_invitations(uuid) from public,anon;
grant execute on function public.manage_household_invites(uuid,text),public.create_household_reinvitation(uuid,uuid,text,text),public.revoke_household_reinvitation(uuid,uuid),public.get_household_invitations(uuid) to authenticated;

-- New clients pass an empty requested code for server-generated 48-bit codes.
-- Installed clients (through build 54) display their proposed 32-bit code without
-- reading the returned code. Honor only valid legacy hexadecimal codes under the
-- same account limits/removal rules. Reject collisions; never silently change it.
create or replace function public.create_household(household_name text,member_name text,member_color text,requested_invite_code text,household_timezone text default 'UTC')
returns table(household_id uuid,invite_code text) language plpgsql security definer set search_path=pg_catalog,public as $$
declare fresh text:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)); target uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('household-admission:'||auth.uid()::text,0));
  if public._household_invitation_budget('host')>0 then raise exception 'Too many household changes. Please try again later.'; end if;
  if household_name is null or length(btrim(household_name)) not between 1 and 60 or member_name is null or length(btrim(member_name)) not between 1 and 60 or member_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Enter a valid household name and member profile'; end if;
  if not exists(select 1 from pg_timezone_names where name=coalesce(nullif(btrim(household_timezone),''),'UTC')) then raise exception 'Choose a valid timezone'; end if;
  if (select count(*) from public.household_members where user_id=auth.uid() and status='active')>=20 then raise exception 'This account has reached its household limit'; end if;
  if nullif(btrim(requested_invite_code),'') is not null then
    if upper(btrim(requested_invite_code)) !~ '^[A-F0-9]{8}$' then raise exception 'Choose a valid household code'; end if;
    fresh:=upper(btrim(requested_invite_code));
  end if;
  insert into public.households(name,invite_code,created_by,timezone) values(btrim(household_name),fresh,auth.uid(),coalesce(nullif(btrim(household_timezone),''),'UTC')) returning id into target;
  insert into public.household_members(household_id,user_id,display_name,color,role,status) values(target,auth.uid(),btrim(member_name),member_color,'owner','active');
  return query select target,fresh;
end $$;

-- Remove the old four-argument overload so it cannot bypass limits. Calls with four arguments resolve to the defaulted five-arg RPC.
drop function if exists public.create_household(text,text,text,text);
revoke all on function public.create_household(text,text,text,text,text) from public,anon;
grant execute on function public.create_household(text,text,text,text,text) to authenticated;

do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='households') then
  alter publication supabase_realtime add table public.households;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
