-- Defense in depth: provider credentials are accessed only by authenticated
-- Edge Functions through service_role. RLS remains enabled with no client policies.
-- No data, existing OAuth grants, sessions, or households are changed.
alter table public.google_calendar_connections enable row level security;
revoke all privileges on table public.google_calendar_connections from public, anon, authenticated;
grant select, insert, update, delete on table public.google_calendar_connections to service_role;
