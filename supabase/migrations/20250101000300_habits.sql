-- ===========================================================================
-- Structra :: 00300 - Habits
--
--   habits              the habit definition
--   habit_completions   one row per completed day
--
-- Reconciliation with the existing Structra HabitItem:
--
-- The app stores `streak: number` as a field the user types into a form, and
-- nothing ever increments it. That is a label, not a streak, and it makes any
-- consistency check meaningless.
--
-- Here the streak is DERIVED from habit_completions, following the same
-- reasoning that governs study_sessions: individual events are stored, and
-- streaks/rates/longest-runs are computed from them. The current streak is a
-- view-level calculation, so it is always consistent with the underlying log
-- and can be corrected retroactively.
-- ===========================================================================

create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,

  name text not null,
  description text,
  frequency public.habit_frequency not null default 'daily',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Soft delete, so completion history and any future analytics survive.
  archived_at timestamptz,

  constraint habits_name_not_blank
    check (char_length(btrim(name)) > 0),
  constraint habits_name_length
    check (char_length(name) <= 120),
  constraint habits_archived_at_is_timestamp
    check (archived_at is null or archived_at >= created_at),

  constraint habits_workspace_id_id_key unique (workspace_id, id)
);

comment on table public.habits is
  'Habit definition. Replaces Structra''s HabitItem, whose streak field was manually entered and never computed.';

drop trigger if exists habits_set_updated_at on public.habits;
  create trigger habits_set_updated_at
  before update on public.habits
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- habit_completions
--
-- `completed_on` is a calendar DATE, not a timestamp: "did I meditate today" is
-- a question about a local day, and storing an instant would make the answer
-- depend on the timezone of whoever wrote the row.
--
-- UNIQUE (habit_id, completed_on) is the important constraint - it makes
-- completion idempotent, so a double-tap, a retried request or a race between
-- two devices cannot inflate a streak.
-- ---------------------------------------------------------------------------
create table if not exists public.habit_completions (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,

  completed_on date not null,
  created_at timestamptz not null default now(),

  constraint habit_completions_unique_per_day
    unique (habit_id, completed_on),

  constraint habit_completions_habit_fk
    foreign key (workspace_id, habit_id)
    references public.habits (workspace_id, id) on delete cascade
);

comment on table public.habit_completions is
  'One row per completed day. Streaks and rates are derived from this log rather than stored.';

-- Supports "my completions in a date range" and streak calculation, which
-- always walks backwards from today.
create index if not exists habit_completions_habit_day_idx
  on public.habit_completions (habit_id, completed_on desc);

create index if not exists habit_completions_user_day_idx
  on public.habit_completions (user_id, completed_on desc);

create index if not exists habit_completions_workspace_id_idx
  on public.habit_completions (workspace_id);


-- ---------------------------------------------------------------------------
-- Derived streak view
--
-- Computes the current consecutive-day streak from the completion log. Returns
-- 0 when the habit was not completed today AND not yesterday, which is the
-- standard convention: a streak stays alive until a full day is missed.
-- ---------------------------------------------------------------------------
drop view if exists public.habit_current_streaks;
create or replace view public.habit_current_streaks
with (security_invoker = true)
as
with ordered as (
  select
    hc.habit_id,
    hc.user_id,
    hc.completed_on,
    hc.completed_on
      - (row_number() over (
          partition by hc.habit_id, hc.user_id
          order by hc.completed_on
        ) - 1)::int as streak_group
  from public.habit_completions hc
),
grouped as (
  select
    habit_id,
    user_id,
    streak_group,
    count(*)::int as streak_length,
    max(completed_on) as last_completed_on
  from ordered
  group by habit_id, user_id, streak_group
)
select
  g.habit_id,
  g.user_id,
  g.streak_length as current_streak,
  g.last_completed_on,
  (g.last_completed_on >= current_date - 1) as is_active
from grouped g
-- Keep only the newest run per habit/user.
where g.last_completed_on = (
  select max(g2.last_completed_on)
  from grouped g2
  where g2.habit_id = g.habit_id and g2.user_id = g.user_id
);

comment on view public.habit_current_streaks is
  'Current consecutive-day streak per habit and user, derived from habit_completions. security_invoker so RLS on the underlying table applies to the viewer.';