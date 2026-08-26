-- Per-user Google Calendar connections (#12). Each row holds one user's own
-- Google refresh token so "Add to Calendar" writes to *their* calendar
-- instead of the single server-wide account the app used before.
--
-- Intentionally no RLS policies are granted to `authenticated`/`anon` — RLS
-- is enabled with zero policies, so ordinary client requests get nothing
-- back at all. Only the API server's service-role key (which bypasses RLS)
-- may read or write this table. Refresh tokens must never be reachable
-- from an authenticated client request, only from the trusted backend.
create table public.google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  scope text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.google_calendar_connections enable row level security;
