-- ===========================================================================
-- Structra :: 01000 - Indexes
--
-- Added after the tables and policies so the planner sees final statistics, and
-- kept separate so an index can be tuned or dropped without touching schema
-- definitions.
--
-- Selection rule: index what the application actually queries and what RLS
-- actually evaluates. Deliberately NOT indexed: columns only ever read as part
-- of a row already fetched by primary key, low-cardinality flags such as
-- completed, and every column of every table. An index that is never used costs
-- write throughput and storage for nothing.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Membership / tenancy
--
-- workspace_members(workspace_id, user_id) already exists as a composite index
-- from the earlier migration; workspace_id alone is covered by its leftmost
-- prefix, so no redundant single-column index is added here.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- tasks
--
-- The default task view is "not done, in my workspace, ordered by due date".
-- A partial index serves exactly that and stays small because completed tasks
-- are excluded.
-- ---------------------------------------------------------------------------
create index if not exists tasks_open_by_due
  on public.tasks (workspace_id, due_at)
  where status in ('todo', 'in_progress', 'blocked');

create index if not exists tasks_created_at_idx
  on public.tasks (workspace_id, created_at desc);

-- Overdue queries filter on completed_at IS NULL, which the partial index above
-- does not imply (archived tasks are also incomplete). Kept narrow.
create index if not exists tasks_incomplete_by_due
  on public.tasks (workspace_id, due_at)
  where completed_at is null;

-- Substring search, matching Structra's existing client-side search box. The
-- trigram operator class makes ILIKE '%term%' indexable.
create index if not exists tasks_title_trgm
  on public.tasks using gin (title extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- habits
-- ---------------------------------------------------------------------------
create index if not exists habits_workspace_active_idx
  on public.habits (workspace_id, created_at desc)
  where archived_at is null;

create index if not exists habit_completions_workspace_day_idx
  on public.habit_completions (workspace_id, completed_on desc);

-- ---------------------------------------------------------------------------
-- study
--
-- Analytics always scans a date range for a workspace and/or user. The leading
-- column matches whichever of the two the caller filters on.
-- ---------------------------------------------------------------------------
create index if not exists study_sessions_workspace_started
  on public.study_sessions (workspace_id, started_at desc);

create index if not exists study_sessions_user_started
  on public.study_sessions (user_id, started_at desc);

create index if not exists study_sessions_subject_started
  on public.study_sessions (workspace_id, subject_id, started_at desc)
  where subject_id is not null;

-- Open sessions (ended_at IS NULL) are few but polled constantly by a running
-- timer, so a tiny partial index pays for itself.
create index if not exists study_sessions_open
  on public.study_sessions (user_id)
  where ended_at is null;

-- ---------------------------------------------------------------------------
-- record system
-- ---------------------------------------------------------------------------
create index if not exists records_workspace_type_idx
  on public.records (workspace_id, record_type_id);

-- The default records view: "in this workspace, this type, newest first".
create index if not exists records_by_type_recent
  on public.records (workspace_id, record_type_id, created_at desc);

create index if not exists records_category_idx
  on public.records (category_id)
  where category_id is not null;

create index if not exists records_created_by_idx
  on public.records (created_by);

create index if not exists records_active_idx
  on public.records (workspace_id, created_at desc)
  where archived_at is null;

-- Substring search over records.title.
create index if not exists records_title_trgm
  on public.records using gin (title extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- groceries
--
-- grocery_lists(workspace_id) and grocery_items(grocery_list_id) already exist
-- from their table migrations. This covers the "what is still to buy" view,
-- which the partial-index form keeps proportional to outstanding items only.
-- ---------------------------------------------------------------------------
create index if not exists grocery_items_outstanding
  on public.grocery_items (grocery_list_id, created_at)
  where completed = false;

-- ---------------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------------
-- The active-notes partial index already exists. Notes are frequently listed by
-- recency across the whole workspace (not filtered by author), so this supports
-- that access path.
create index if not exists notes_workspace_recent_idx
  on public.notes (workspace_id, created_at desc);