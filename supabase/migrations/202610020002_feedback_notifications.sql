-- Supabase-native retry scheduler. Missing secrets leave the durable queue intact.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create or replace function public.dispatch_feedback_notifications()
returns void language plpgsql security definer set search_path = '' as $$
declare project_url text; worker_token text;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'feedback_project_url';
  select decrypted_secret into worker_token from vault.decrypted_secrets where name = 'feedback_worker_token';
  if project_url is null or worker_token is null then return; end if;
  if not exists (select 1 from public.feedback where notification_sent_at is null
    and notification_next_attempt_at <= now()
    and (notification_locked_until is null or notification_locked_until < now())) then return; end if;
  perform net.http_post(
    url := project_url || '/functions/v1/notify-feedback',
    headers := jsonb_build_object('Authorization', 'Bearer ' || worker_token, 'Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 120000
  );
end;
$$;
revoke all on function public.dispatch_feedback_notifications() from public, anon, authenticated;
select cron.schedule('feedback-notifications', '*/5 * * * *', 'select public.dispatch_feedback_notifications()');
