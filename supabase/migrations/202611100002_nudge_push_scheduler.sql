create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create or replace function public.dispatch_nudge_push()
returns void language plpgsql security definer set search_path = '' as $$
declare project_url text; worker_token text;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name='nudge_push_project_url';
  select decrypted_secret into worker_token from vault.decrypted_secrets where name='nudge_push_worker_token';
  if project_url is null or worker_token is null then return; end if;
  if not exists(select 1 from public.nudge_push_deliveries where state in ('pending','receipt') and next_attempt_at <= now() and (locked_until is null or locked_until < now())) then return; end if;
  perform net.http_post(url := project_url || '/functions/v1/nudge-push',
    headers := jsonb_build_object('Authorization','Bearer ' || worker_token,'Content-Type','application/json'),
    body := '{}'::jsonb,timeout_milliseconds := 120000);
end;
$$;
revoke all on function public.dispatch_nudge_push() from public,anon,authenticated;
select cron.schedule('nudge-push','* * * * *','select public.dispatch_nudge_push()');
