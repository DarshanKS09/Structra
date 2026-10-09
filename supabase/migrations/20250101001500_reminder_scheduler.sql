-- ===========================================================================
-- Structra :: 01500 - Reminder scheduler (Supabase Cron + pg_net)
--
-- Purpose
--   Migration 01400 built everything the reminder sweep needs: the persisted
--   schedule, the concurrency claim, the notification rows, the delivery record
--   and the retry cap. What it cannot build is a TIMER. Supabase does not run
--   your Next.js server, and nothing in a database schema wakes itself up on a
--   schedule, so without this file reminders are stored correctly and never
--   delivered.
--
--   So the scheduler is installed on the side that IS always running: pg_cron
--   inside Postgres, calling the existing endpoint over HTTP through pg_net. No
--   new application code and no new service - it is the same endpoint a Vercel
--   cron would hit, and the same `runReminderDispatch` behind it.
--
--   `vercel.json` in this repository declares an equivalent five-minute cron for
--   a Vercel deployment. Pick the ONE that matches where the app actually runs.
--   Running both is harmless - delivery is claimed atomically, so a double
--   schedule cannot double-send - but it is unnecessary.
--
-- ---------------------------------------------------------------------------
-- STATUS: NOT APPLIED. THIS FILE IS A TEMPLATE.
-- ---------------------------------------------------------------------------
-- It deliberately refuses to run until the two settings below are filled in,
-- because applying it against a placeholder origin or a placeholder secret
-- produces a job that runs every five minutes and fails every time - which looks
-- exactly like "reminders are broken" and hides the real reason.
--
-- ---------------------------------------------------------------------------
-- BEFORE YOU RUN IT
-- ---------------------------------------------------------------------------
-- 1. STRUCTRA MUST BE DEPLOYED AND REACHABLE OVER PUBLIC HTTPS. This job calls
--    an external URL; it cannot reach localhost. If the app is not deployed, the
--    migration will succeed and every reminder email will silently never be
--    sent. This is the single most likely reason for "I applied it and nothing
--    happens".
--
-- 2. THE APP'S DEPLOYMENT MUST HAVE CRON_SECRET SET, and to the same value as
--    `cron_secret` below. Since 01400 the endpoint REFUSES TO RUN IN PRODUCTION
--    without one and returns 503. Set it in BOTH stores, which are independent:
--      - the hosting platform's environment variables (Vercel/Netlify/etc.)
--      - `npx supabase secrets set CRON_SECRET=<value>`
--    Setting only one produces a silent 401. On Vercel, Cron sends
--    `Authorization: Bearer $CRON_SECRET` automatically, which is why the
--    endpoint accepts that header.
--
-- 3. Verify the origin below is the one users actually visit. The reminder email
--    links to it, so a wrong value puts a dead link in every notification.
-- ===========================================================================

do $$
declare
  -- >>> EDIT THESE TWO LINES <<<
  app_origin  text := 'https://REPLACE-WITH-YOUR-DEPLOYED-ORIGIN';
  cron_secret text := 'REPLACE-WITH-YOUR-CRON-SECRET';

  job_name  text := 'structra-reminder-dispatch';
  endpoint  text;
  schedule  text := '*/5 * * * *';
begin
  if app_origin like '%REPLACE%' or cron_secret like '%REPLACE%' then
    raise exception
      'Edit the SETTINGS block at the top of this migration before running it. '
      'Until then the job would call a placeholder origin and fail every run.';
  end if;

  if app_origin !~ '^https://' then
    raise exception 'app_origin must start with https:// (got %)', app_origin;
  end if;

  if length(cron_secret) < 32 then
    raise exception 'cron_secret must be at least 32 characters (got %)', length(cron_secret);
  end if;

  endpoint := rtrim(app_origin, '/') || '/api/reminders/dispatch';

  -- -------------------------------------------------------------------------
  -- Extensions
  --
  -- pg_cron is the scheduler; pg_net performs the outbound HTTP request.
  -- Neither is guaranteed present on a hosted project, so both are created
  -- conditionally and a failure is RAISED rather than swallowed. A silently
  -- absent scheduler is indistinguishable from broken reminders.
  -- -------------------------------------------------------------------------
  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    raise exception
      'Could not enable pg_cron: %. Enable it under Database > Extensions > pg_cron, then re-run.',
      sqlerrm;
  end;

  begin
    create extension if not exists pg_net with schema extensions;
  exception when others then
    raise exception
      'Could not enable pg_net: %. Enable it under Database > Extensions > pg_net, then re-run.',
      sqlerrm;
  end;

  -- -------------------------------------------------------------------------
  -- REPLICA IDENTITY - the non-obvious requirement
  --
  -- pg_cron runs its jobs over the logical replication connection, which defaults
  -- to REPLICA. Rows written by such a connection are NOT visible to ordinary
  -- readers until the replication slot advances - including to the NEXT sweep.
  -- Without this, a notification written by one run can be invisible to the
  -- following one, which presents as an intermittently broken scheduler.
  -- -------------------------------------------------------------------------
  alter table public.task_notifications replica identity full;
  alter table public.tasks replica identity full;

  -- Re-running after an edit is a normal operation, so replace rather than fail
  -- if a previous version of this job exists.
  if exists (select 1 from cron.job where jobname = job_name) then
    perform cron.unschedule(job_name);
  end if;

  perform cron.schedule(
    job_name,
    schedule,
    -- net.http_post is ASYNCHRONOUS and returns a request id immediately. It
    -- does NOT tell us whether any email was sent: the honest per-run outcome
    -- (claimed / notified / emailed / emailFailed) is in the endpoint's own
    -- response, which your host logs. A 200 body showing emailFailed > 0 means
    -- the reminder was raised but the mail did not go out.
    --
    -- The 30s timeout is generous for a 200-item sweep and stops a hung endpoint
    -- from pinning a cron connection.
    $inner$
      select net.http_post(
        url     := endpoint,
        method  := 'POST',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || cron_secret
        ),
        body    := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
    $inner$
  );

  raise notice 'Reminder job "%" scheduled: % -> %', job_name, schedule, endpoint;
  raise notice 'Confirm it fires:  select jobname, schedule, active from cron.job where jobname = %',
    quote_literal(job_name);
  raise notice 'Read a response:  select status_code, content from net._http_response order by id desc limit 1;';
end $$;

-- ===========================================================================
-- VERIFYING - run these by hand
-- ===========================================================================
--
-- Is the job installed and active?
--   select jobname, schedule, active from cron.job
--    where jobname = 'structra-reminder-dispatch';
--
-- Has it run, and what did the endpoint answer? (pg_cron exposes last_run_time
-- on newer versions; otherwise use the request id from the notice above.)
--   select * from net._http_response order by id desc limit 1;
--   -- net._http_response.status_code / .content hold the endpoint's report:
--   --   200 -> ok:true  ... inspect emailed / emailFailed / notified inside
--   --   401 -> CRON_SECRET does not match the app's
--   --   503 -> CRON_SECRET is not set in the app's production environment
--
-- Is the endpoint reachable from the database at all?
--   select net.http_post(
--     url     := 'https://YOUR-ORIGIN/api/reminders/dispatch',
--     headers := jsonb_build_object('Authorization', 'Bearer YOUR-SECRET'),
--     body    := '{}'::jsonb
--   );
--   select status_code, content from net._http_response order by id desc limit 1;
--
-- End-to-end proof that a reminder actually delivers:
--   1. Create a task with a deadline ~12 minutes out and the "10 minutes before"
--      reminder. (01300 requires a deadline; 01400 computes reminder_at from it.)
--   2. wait for the job, then:
--        select id, title, reminder_at, reminder_emailed_at, reminder_emailed_at is not null as emailed,
--               reminder_last_error from tasks order by created_at desc limit 1;
--        select task_id, title, read_at from task_notifications order by created_at desc limit 1;
--   3. Both the task's reminder_emailed_at and a notification row should exist,
--      and the email should be in the account inbox.
--   Anything else is explained by reminder_last_error, which records the reason
--   rather than leaving a failed send indistinguishable from a successful one.
--
-- ===========================================================================
-- REMOVING IT
-- ===========================================================================
--   select cron.unschedule('structra-reminder-dispatch');
--
-- ===========================================================================
-- IF YOU HOST ON VERCEL INSTEAD
-- ===========================================================================
-- `vercel.json` already declares the same five-minute cron, so skip this file.
-- Keep `CRON_SECRET` in the Vercel project's environment variables.
