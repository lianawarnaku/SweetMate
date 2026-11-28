begin;
do $$
begin
  if not (select relrowsecurity from pg_class where oid='public.google_calendar_connections'::regclass) then raise exception 'Google token RLS must remain enabled'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='google_calendar_connections') then raise exception 'Google credentials must have no ordinary-client policy'; end if;
  if has_table_privilege('anon','public.google_calendar_connections','SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated','public.google_calendar_connections','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Client Google credential privileges must be revoked'; end if;
  if not has_table_privilege('service_role','public.google_calendar_connections','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Calendar backend must retain credential access'; end if;
end $$;
set local role anon;
do $$ begin
  begin perform refresh_token from public.google_calendar_connections; raise exception 'Anonymous token read was allowed'; exception when insufficient_privilege then null; end;
  begin insert into public.google_calendar_connections(user_id,refresh_token) values(gen_random_uuid(),'fixture-only'); raise exception 'Anonymous token write was allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin perform refresh_token from public.google_calendar_connections; raise exception 'Authenticated token read was allowed'; exception when insufficient_privilege then null; end;
  begin update public.google_calendar_connections set refresh_token='fixture-only'; raise exception 'Authenticated token update was allowed'; exception when insufficient_privilege then null; end;
  begin delete from public.google_calendar_connections; raise exception 'Authenticated token delete was allowed'; exception when insufficient_privilege then null; end;
end $$;
rollback;
