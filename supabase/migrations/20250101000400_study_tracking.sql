-- ===========================================================================
-- Structra :: 00400 - Study tracking
--
--   study_subjects   workspace-scoped subject taxonomy
--   study_sessions   one row per study session, never a rolled-up total
--
-- Reconciliation with the existing Structra StudyItem:
--
-- The app stores `estimatedStudyTime` as a free-text string such as "45 min"
-- that is never parsed and never accumulated. There is no timer and no record
-- of time actually spent, so the app cannot answer "how much did I study this
-- week".
--
-- The schema fixes this at the data layer by storing discrete sessions with
-- real timestamps. Aggregations (daily/weekly/monthly totals, per-subject
-- breakdowns, streaks) are then computed from those rows with ordinary SQL, so
-- a new report never requires backfilling or re-deriving stored counters.
--
-- `duration_seconds` is a STORED GENERATED column rather than an ordinary
-- column: it is derived from started_at/ended_at by Postgres itself, so it can
-- never disagree with the timestamps it summarises.
-- ===========================================================================

create table if not exists public.study_subjects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint study_subjects_name_not_blank
    check (char_length(btrim(name)) > 0),
  constraint study_subjects_name_length
    check (char_length(name) <= 120),

  constraint study_subjects_workspace_id_id_key unique (workspace_id, id),
  constraint study_subjects_name_unique_per_workspace
    unique (workspace_id, name)
);

comment on table public.study_subjects is
  'Workspace-scoped subject taxonomy for study sessions. Replaces the free-text subject/topic strings on the app''s StudyItem.';

drop trigger if exists study_subjects_set_updated_at on public.study_subjects;
  create trigger study_subjects_set_updated_at
  before update on public.study_subjects
  for each row execute function public.set_updated_at();


create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Subject reference is nullable: a session may be logged before the user has
  -- classified it. Composite FK prevents a session referencing a subject that
  -- belongs to a different workspace.
  subject_id uuid,

  topic text,

  started_at timestamptz not null,
  ended_at timestamptz,

  -- Derived by Postgres from started_at/ended_at. Cannot be set by a client and
  -- cannot drift. NULL while the session is still running.
  duration_seconds integer
    generated always as (
      case
        when ended_at is null then null
        else (extract(epoch from (ended_at - started_at))::integer)
      end
    ) stored,

  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint study_sessions_subject_fk
    foreign key (workspace_id, subject_id)
    references public.study_subjects (workspace_id, id) on delete set null,

  -- A session cannot end before it starts. Without this, a clock-skewed client
  -- could persist negative durations.
  constraint study_sessions_ended_after_started
    check (ended_at is null or ended_at >= started_at),

  -- One session cannot start in the future beyond a small clock-skew allowance.
  constraint study_sessions_started_not_absurd_future
    check (started_at <= now() + interval '1 day'),

  constraint study_sessions_workspace_id_id_key unique (workspace_id, id)
);

comment on table public.study_sessions is
  'Individual study sessions, retained rather than pre-aggregated so daily/weekly/monthly analytics can be computed in SQL.';

drop trigger if exists study_sessions_set_updated_at on public.study_sessions;
  create trigger study_sessions_set_updated_at
  before update on public.study_sessions
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- Daily rollup VIEW (not a table)
--
-- Deliberately a view. Storing a daily total would mean maintaining it on every
-- insert and on every retroactive edit or deletion of a session - two sources
-- of truth that inevitably disagree. Computing it keeps the session log as the
-- single source of truth.
--
-- Aggregates in the viewer's timezone would require a per-user zone lookup;
-- grouping is done in UTC here, which is the correct default for a shared
-- workspace. A per-user local-day report can group on
-- (started_at at time zone profile.timezone) instead.
-- ---------------------------------------------------------------------------
drop view if exists public.study_daily_totals;
create or replace view public.study_daily_totals
with (security_invoker = true)
as
select
  ss.workspace_id,
  ss.user_id,
  ss.subject_id,
  (ss.started_at at time zone 'utc')::date as day,
  count(*)::int as session_count,
  coalesce(sum(ss.duration_seconds), 0)::bigint as total_seconds
from public.study_sessions ss
where ss.ended_at is not null
group by ss.workspace_id, ss.user_id, ss.subject_id, (ss.started_at at time zone 'utc')::date;

comment on view public.study_daily_totals is
  'Per-day study totals derived from study_sessions. security_invoker so RLS on the underlying table applies to the viewer.';