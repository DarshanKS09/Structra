-- ===========================================================================
-- Structra :: 01400 - Task reminder delivery: persisted schedule, persistent
--                   in-app notifications, honest delivery state
--
-- Purpose
--   Migration 01300 gave tasks a reminder OFFSET and a single `reminder_sent_at`
--   timestamp. That is enough to decide *whether* a reminder is due, and not
--   enough to actually deliver one reliably. Three gaps follow from that shape:
--
--   1. THE SCHEDULED INSTANT WAS NOT PERSISTED.
--      `reminder_at` was derived on every read, in application code, as
--      `due_at - reminder_offset_minutes`. That is correct arithmetic, but it
--      means the database has no record of WHEN a reminder is meant to fire, no
--      index can cover it, and "which reminders are due?" is answered by the
--      client rather than by SQL. Fixed here by persisting the instant and
--      maintaining it from a trigger, so it cannot disagree with the deadline -
--      the property the 01300 comment argues for and the previous
--      implementation could not actually guarantee.
--
--   2. IN-APP NOTIFICATIONS WERE EPHEMERAL UI STATE.
--      The reminder card was a live filter over due tasks, recomputed by a
--      60-second poll in whichever tab happened to be open. With the app closed
--      nothing was ever shown on return, because the poll had not run.
--
--      Worse, DISMISSING THE CARD WROTE `reminder_sent_at`. That is the same
--      column the email sweep uses to decide what has already gone out, so
--      simply looking at a reminder and closing it silently suppressed the
--      email for that task forever. Reading a notification was destroying a
--      message. This migration separates the two concerns entirely: the card now
--      reads persisted rows, and acknowledging one touches only its own row.
--
--   3. DELIVERY STATE WAS A SINGLE AMBIGUOUS TIMESTAMP.
--      `reminder_sent_at` conflated "the user saw this" with "an email went
--      out", and recorded nothing about failure, so a reminder that failed to
--      send looked exactly like one that had succeeded and could not be retried
--      deliberately.
--
-- No existing table is replaced and no column is removed. `reminder_sent_at` is
-- deliberately KEPT: application code still reads it, and dropping it would
-- break every deployed client. The new columns are the honest record; the view
-- at the end reports a single unambiguous status derived from all of them.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- tasks: the persisted schedule
-- ---------------------------------------------------------------------------
-- `reminder_at` is a PLAIN column maintained by the trigger below, not a
-- GENERATED column. A generated column was the first choice - it cannot drift by
-- construction - and it was rejected because it is not achievable in PostgreSQL.
-- Verified empirically against this project rather than assumed:
--
--   SELECT ... generated always as (due_at) stored                          -> OK
--   SELECT ... generated always as (case when due_at is null then null
--                                      else due_at end) stored              -> OK
--   SELECT ... generated always as (reminder_offset_minutes
--                                      * interval '1 minute') stored        -> OK
--   SELECT ... generated always as (due_at - interval '1 minute') stored     -> ERROR
--   SELECT ... generated always as (due_at - make_interval(mins => 10))     -> ERROR
--
-- The failing part is the SUBTRACTION, not the interval construction:
-- PostgreSQL classifies `timestamptz - interval` as STABLE rather than
-- IMMUTABLE, because subtracting a calendar interval from a timezone-aware
-- instant genuinely can depend on the session's TimeZone. A generated column
-- requires IMMUTABLE, so any expression of this shape is rejected - even when
-- the interval is a literal and could not possibly vary.
--
-- A BEFORE trigger runs in a normal statement, where STABLE functions are
-- allowed, so the value is still computed by Postgres from the same row and in
-- the same transaction as the deadline change that caused it. The property that
-- actually matters - the reminder instant can never disagree with the deadline,
-- because no client ever writes it - is fully preserved. Only the mechanism
-- changes.
alter table public.tasks
  add column if not exists reminder_at timestamptz;

comment on column public.tasks.reminder_at is
  'The instant this task''s reminder fires. Maintained by the tasks_maintain_reminder trigger from due_at and reminder_offset_minutes; never written by a client. Persisted and indexable. NULL means no reminder is scheduled.';

-- ---------------------------------------------------------------------------
-- tasks: the delivery record
-- ---------------------------------------------------------------------------
-- These answer "what actually happened", which the old single timestamp could
-- not. `reminder_attempts` and `reminder_last_error` exist purely so a failed
-- send is retryable and diagnosable rather than indistinguishable from success.
alter table public.tasks
  add column if not exists reminder_notified_at timestamptz,
  add column if not exists reminder_emailed_at timestamptz,
  add column if not exists reminder_attempts integer not null default 0,
  add column if not exists reminder_last_error text;

comment on column public.tasks.reminder_notified_at is
  'When the persistent in-app notification was created for this reminder. Independent of email: acknowledging a notification never touches this, and a failed email never resets it.';

comment on column public.tasks.reminder_emailed_at is
  'When the reminder email was accepted by the SMTP relay. NULL after a failure, which is what makes a retry meaningful rather than a duplicate.';

comment on column public.tasks.reminder_attempts is
  'How many times delivery has been attempted for the current arming. Incremented as part of the claim, so two concurrent sweeps cannot both send.';

comment on column public.tasks.reminder_last_error is
  'Why the last delivery attempt failed, in operator-facing language. Cleared on the next successful send.';

alter table public.tasks
  drop constraint if exists tasks_reminder_attempts_non_negative;
alter table public.tasks
  add constraint tasks_reminder_attempts_non_negative
    check (reminder_attempts >= 0);

-- The sweep's hot path: due, open, offset configured, not yet emailed. A partial
-- index keeps the scan proportional to what is actually pending rather than to
-- the user's whole task history.
create index if not exists tasks_reminder_due_idx
  on public.tasks (reminder_at)
  where reminder_offset_minutes is not null
    and reminder_emailed_at is null
    and status <> 'done';

-- Supports "what is armed and undelivered" for the in-app read path.
create index if not exists tasks_reminder_pending_notified_idx
  on public.tasks (reminder_at)
  where reminder_offset_minutes is not null
    and reminder_notified_at is null
    and status <> 'done';

-- ---------------------------------------------------------------------------
-- task_notifications: the persistent in-app notification
-- ---------------------------------------------------------------------------
-- Why a new table rather than a boolean on `tasks`: a notification has a
-- lifecycle of its own - when it was created, whether it has been read, when -
-- and one task can legitimately raise more than one notification over its life
-- (the deadline is moved, the reminder re-arms). A flag on the task cannot
-- represent "read at", and cannot represent history.
--
-- Rows are written ONLY by the server-side dispatcher using the service role.
-- There is deliberately no INSERT policy for `authenticated` below, so a client
-- cannot fabricate a notification even against its own workspace.
create table if not exists public.task_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,

  title text not null,
  body text,

  -- Kept as a copy rather than read through the task, so the notification still
  -- renders if the task is edited or deleted afterwards.
  offset_minutes integer,
  due_at timestamptz,

  created_at timestamptz not null default now(),
  read_at timestamptz,

  constraint task_notifications_title_not_blank
    check (char_length(btrim(title)) > 0)
);

comment on table public.task_notifications is
  'Persistent in-app reminder notifications. Written only by the reminder dispatcher (service role). Survives refresh, logout and login, and does not require a browser tab to be open.';

-- No `set_updated_at` trigger here, deliberately. `public.set_updated_at()`
-- assigns `new.updated_at`, so attaching it to a table without that column fails
-- at runtime with "record NEW has no field updated_at". The column would be dead
-- weight in any case: the only field a notification ever changes is `read_at`,
-- which already carries its own timestamp. Adding `updated_at` purely to satisfy
-- a shared trigger would create two competing notions of "when did this last
-- change".
--
-- The unique index below is the structural duplicate guard.
-- claim logic in the dispatcher were wrong, or the sweep somehow ran twice
-- concurrently, the database refuses to produce two notifications for the same
-- task. This is what makes "never notify twice" structural rather than best
-- effort.
create unique index if not exists task_notifications_task_user_key
  on public.task_notifications (task_id, user_id);

-- Inbox read path: "my unread notifications, newest first".
create index if not exists task_notifications_user_recent_idx
  on public.task_notifications (user_id, created_at desc)
  where read_at is null;

alter table public.task_notifications enable row level security;

-- SELECT: strictly your own. Scoped by user_id rather than workspace, so a user
-- can never see a colleague's reminders even inside a shared workspace.
drop policy if exists task_notifications_select_own on public.task_notifications;
create policy task_notifications_select_own
  on public.task_notifications for select to authenticated
  using (user_id = auth.uid());

-- UPDATE: your own rows only, and only to acknowledge. There is no INSERT or
-- DELETE policy at all - those are the dispatcher's job, via the service role.
drop policy if exists task_notifications_update_own on public.task_notifications;
create policy task_notifications_update_own
  on public.task_notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- task_reminder_status: one unambiguous answer to "where is this reminder?"
-- ---------------------------------------------------------------------------
-- A VIEW rather than a stored status column, for the same reason 01300's
-- `task_due_reminders` is a view: a stored status is a second source of truth
-- that inevitably disagrees with the timestamps it summarises. Deriving it means
-- there is exactly one definition, and it cannot be wrong.
--
-- The precedence order is the whole point of this view:
--   emailed   - the relay accepted it. Highest, because it is the outcome that
--               matters and it cannot be un-done.
--   failed    - an attempt was made and did not succeed. Above `notified`,
--               because a user who saw the card but whose email bounced still has
--               something to act on.
--   notified  - the in-app notification exists, email not attempted or pending.
--   scheduled - armed, nothing delivered yet.
--   cancelled - the task is done or archived, so it will never deliver.
--   none      - no deadline or no reminder configured.
--
-- security_invoker so RLS on `tasks` applies to the viewer.
drop view if exists public.task_reminder_status;
create or replace view public.task_reminder_status
with (security_invoker = true)
as
select
  t.id,
  t.workspace_id,
  t.created_by,
  t.title,
  t.due_at,
  t.status,
  t.reminder_offset_minutes,
  t.reminder_at,
  t.reminder_notified_at,
  t.reminder_emailed_at,
  t.reminder_attempts,
  t.reminder_last_error,
  t.reminder_sent_at,
  case
    when t.reminder_at is null then 'none'
    when t.status in ('done', 'archived') then 'cancelled'
    when t.reminder_emailed_at is not null then 'emailed'
    when t.reminder_last_error is not null then 'failed'
    when t.reminder_notified_at is not null then 'notified'
    else 'scheduled'
  end as reminder_status
from public.tasks t;

comment on view public.task_reminder_status is
  'Per-task reminder delivery state, DERIVED from the timestamps so it cannot drift. Statuses: none, scheduled, notified, emailed, failed, cancelled. security_invoker so RLS on tasks applies.';

-- ---------------------------------------------------------------------------
-- tasks_maintain_reminder: keep the schedule correct and re-arm on change
-- ---------------------------------------------------------------------------
-- ONE trigger doing two jobs, because both must be true for every write path -
-- the section screen, the Dashboard, a future import - and a second trigger
-- would only create an ordering question between them.
--
--   1. RECOMPUTE `reminder_at` from `due_at` and `reminder_offset_minutes`.
--      Runs on INSERT and UPDATE. This is the only writer of the column.
--
--   2. RE-ARM when the schedule genuinely changed. Editing a deadline or
--      changing the offset must deliver again; `reminder_at` is recomputed
--      automatically, but the delivery record is ordinary data and would
--      otherwise suppress the new reminder forever because it already carries a
--      timestamp.
--
-- Deliberately fires ONLY on a schedule change. An unrelated edit - renaming a
-- task, changing its priority - must not cause a second email, so the
-- comparison is on the two columns that actually define the schedule.
create or replace function public.tasks_maintain_reminder()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- 1. The persisted schedule. NULL when either input is absent, which is what
  --    makes `reminder_at is null` a reliable "nothing is scheduled" test.
  if new.due_at is null or new.reminder_offset_minutes is null then
    new.reminder_at := null;
  else
    new.reminder_at := new.due_at - make_interval(mins => new.reminder_offset_minutes);
  end if;

  -- 2. Re-arm. Guarded by TG_OP so an INSERT cannot "differ" from a nonexistent
  --    previous row, and by the IS DISTINCT FROM comparison so a no-op update
  --    does not reset a delivery that already happened.
  if tg_op = 'UPDATE' then
    if new.reminder_offset_minutes is distinct from old.reminder_offset_minutes
       or new.due_at is distinct from old.due_at then
      new.reminder_notified_at := null;
      new.reminder_emailed_at := null;
      new.reminder_sent_at := null;
      new.reminder_attempts := 0;
      new.reminder_last_error := null;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.tasks_maintain_reminder() is
  'Maintains tasks.reminder_at from due_at and reminder_offset_minutes, and clears the reminder delivery record when the schedule changes. The only writer of reminder_at.';

drop trigger if exists tasks_maintain_reminder on public.tasks;
  create trigger tasks_maintain_reminder
    before insert or update on public.tasks
    for each row execute function public.tasks_maintain_reminder();

-- ---------------------------------------------------------------------------
-- SECURITY: revoke RPC access to the SECURITY DEFINER helpers introduced earlier
-- ---------------------------------------------------------------------------
-- Found while verifying 01300, and fixed here because this migration is the one
-- an operator is about to run anyway. Both of these are SECURITY DEFINER and
-- were callable by ANY client through PostgREST's /rpc endpoint, including with
-- the anonymous key:
--
--   purge_spent_otp_challenges(older_than => interval '0 seconds')
--       deleted EVERY OTP challenge, including live ones, in one unauthenticated
--       request - a registration denial-of-service.
--
--   backfill_missing_personal_workspaces()
--       iterated every auth.users row and wrote profiles, workspaces and
--       membership rows. Unauthenticated write amplification across all users.
--
-- Both are legitimate maintenance functions, run manually via SQL. They have no
-- reason to be reachable over HTTP. The table-level revoke in 01100 does not
-- cover a function that deletes FROM that table.
revoke execute on function public.purge_spent_otp_challenges(interval)
  from public, anon, authenticated;
revoke execute on function public.backfill_missing_personal_workspaces()
  from public, anon, authenticated;
