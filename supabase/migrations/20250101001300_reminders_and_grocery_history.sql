-- ===========================================================================
-- Structra :: 01300 - Task reminders and grocery-list history
--
-- Purpose
--   Two small additive changes, both extending tables that already exist rather
--   than introducing new ones:
--
--     tasks.reminder_offset_minutes / reminder_sent_at
--         Make a task deadline mandatory and schedulable, and make "clear the
--         shopping" preserve what was bought instead of destroying it.
--
--   Neither feature gets its own table. See the reasoning below, because that is
--   the single most important decision in this migration.
--
-- ===========================================================================
--
-- WHY REMINDERS ARE COLUMNS ON `tasks`, NOT A SEPARATE TABLE
-- ===========================================================================
--
-- The obvious design is a `task_reminders` table. It is the wrong one here.
--
-- A reminder is not independent data: it is a function of a task's deadline and
-- a chosen offset. Storing it as its own row would create four problems that
-- columns avoid outright:
--
--   1. Deadline changes. Editing `tasks.due_at` must reschedule the reminder.
--      With a separate row that means a write to two tables in one logical
--      operation, which can half-fail and leave a reminder pointing at a
--      deadline the task no longer has.
--
--   2. Deletion. `on delete cascade` handles the child rows, so that is fine -
--      but only because the FK exists. Every extra row is extra state to reason
--      about for no gain.
--
--   3. Duplicates. Nothing structurally prevents two reminder rows for the same
--      task. Columns make duplication impossible: there is one offset.
--
--   4. Completion. A completed task must stop reminding. With a separate table
--      that is another condition to enforce; here it falls out of the existing
--      `status` check in the view below.
--
-- By storing the OFFSET rather than an absolute fire time, the reminder time is
-- always derived:
--
--     reminder_at = due_at - reminder_offset_minutes
--
-- so it cannot disagree with the deadline. There is nothing to resynchronise.
--
-- What a separate table WOULD have been needed for - a per-reminder delivery
-- log - collapses to one nullable timestamp, `reminder_sent_at`, because a task
-- has at most one reminder. That is what makes email dispatch idempotent.
--
-- TIMEZONE
--
-- `due_at` is timestamptz and the offset is an integer number of minutes, so
-- reminder_at is pure arithmetic on an absolute instant. No local-time
-- conversion happens anywhere, which is why a reminder fires at the same instant
-- regardless of where the user or the server is. This deliberately avoids the
-- classic bug of mixing a browser-local deadline with a server-UTC scheduler.
-- `profiles.timezone` stays available for *display* ("what time is that for
-- me?") without being load-bearing for *scheduling*.
--
-- ===========================================================================
--
-- WHY GROCERY LISTS GET A `completed_at`
-- ===========================================================================
--
-- `grocery_lists` had no lifecycle column, so `clearCompletedGroceryItems`
-- deleted the purchased rows outright - the shopping history was destroyed every
-- time a list was cleared. A nullable `completed_at` makes an archived list a
-- first-class row instead of a deletion:
--
--     completed_at IS NULL      the ACTIVE list
--     completed_at IS NOT NULL  a previous trip, preserved with its items
--
-- Items are never deleted by "clear" any more. Nothing is dropped, so history
-- survives refresh, logout/login and being looked at months later.
--
-- NULL rather than a boolean or a status enum, for the same reason
-- `tasks.completed_at` is a timestamp: "when did this trip finish" is the fact
-- the history view actually shows, and it is also free to index.
--
-- ===========================================================================
--
-- SAFETY
--
-- Additive only. Two nullable columns on tasks, one nullable column on
-- grocery_lists, one view. No existing column is altered, no data is rewritten,
-- and no constraint is tightened - so this cannot fail on a populated table.
--
-- Critically, `tasks.due_at` stays NULLABLE even though the application now
-- requires a deadline on create. On this project 3 of 6 existing tasks have a
-- NULL `due_at`, and a NOT NULL constraint would fail the migration outright.
-- Legacy rows are surfaced in the UI as "No deadline" and are excluded from
-- deadline-driven analytics, rather than being given an invented deadline.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- tasks: reminder configuration
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists reminder_offset_minutes integer,
  add column if not exists reminder_sent_at timestamptz;

comment on column public.tasks.reminder_offset_minutes is
  'Minutes before due_at to remind the user. NULL means no reminder. The reminder instant is derived as due_at - reminder_offset_minutes, never stored, so it cannot drift from the deadline.';

comment on column public.tasks.reminder_sent_at is
  'When a reminder was last dispatched for this task. Makes dispatch idempotent: a task is only ever notified once per reminder, so re-running the sweep cannot spam.';

-- Only sane offsets are storable. A negative offset would schedule the reminder
-- AFTER the deadline, which is not a reminder; an absurdly large one would push
-- it into the far future. 1 week is generous but bounded.
alter table public.tasks
  drop constraint if exists tasks_reminder_offset_sane;
alter table public.tasks
  add constraint tasks_reminder_offset_sane
    check (
      reminder_offset_minutes is null
      or (reminder_offset_minutes > 0 and reminder_offset_minutes <= 10080)
    );

-- ---------------------------------------------------------------------------
-- Index for the reminder sweep.
--
-- Partial on exactly the rows a sweep cares about: a live task, with a deadline,
-- with a reminder configured, that has not been notified yet. That set is tiny
-- even when the user has thousands of historical tasks, so the sweep stays cheap
-- and never scans completed work.
-- ---------------------------------------------------------------------------
create index if not exists tasks_reminder_pending_idx
  on public.tasks (due_at)
  where reminder_offset_minutes is not null
    and reminder_sent_at is null
    and status <> 'done';

-- ---------------------------------------------------------------------------
-- Due-reminders VIEW (not a table)
--
-- A view, for the same reason `study_daily_totals` is one: the set is derived
-- from tasks, so storing it would be a second source of truth that inevitably
-- disagrees. Deriving it means "which reminders are due" has exactly one
-- definition, shared by the in-app poll and the email sweep - they cannot drift.
--
-- security_invoker so RLS on `tasks` applies to the viewer, which is what keeps
-- one user's reminders invisible to another. The view adds no policy of its own
-- and grants no extra access.
--
-- `reminder_due_at` is the fire time. The `reminder_armed` flag distinguishes
-- "already passed" from "coming up", so the UI can style the two differently.
-- ---------------------------------------------------------------------------
drop view if exists public.task_due_reminders;
create or replace view public.task_due_reminders
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
  t.reminder_sent_at,
  (t.due_at - make_interval(mins => t.reminder_offset_minutes)) as reminder_due_at
from public.tasks t
where t.reminder_offset_minutes is not null
  and t.status <> 'done'
  and t.due_at is not null
  and (
    t.reminder_sent_at is null
    or t.reminder_sent_at < t.updated_at
  );

comment on view public.task_due_reminders is
  'Tasks with an un-notified reminder, with the derived reminder instant. security_invoker so RLS on tasks applies. reminder_sent_at is cleared whenever the task is edited, which re-arms the reminder.';

-- ---------------------------------------------------------------------------
-- grocery_lists: history lifecycle
-- ---------------------------------------------------------------------------
alter table public.grocery_lists
  add column if not exists completed_at timestamptz;

comment on column public.grocery_lists.completed_at is
  'When this shopping trip was completed. NULL means the list is the ACTIVE list; a non-null value marks a preserved previous trip whose items are retained for history.';

-- Supports both access paths the UI needs with one index: "the active list"
-- (NULLs first) and "history, newest first" in a single ordering.
create index if not exists grocery_lists_workspace_recent_idx
  on public.grocery_lists (workspace_id, completed_at desc nulls first, created_at desc);