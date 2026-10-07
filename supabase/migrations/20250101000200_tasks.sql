-- ===========================================================================
-- Structra :: 00200 - Tasks
--
--   task_categories          workspace-scoped labels for organising tasks
--   task_category_links      many-to-many assignment
--   tasks                    the task itself
--
-- Reconciliation with the existing Structra TaskItem:
--
--   title       -> title        (required, unchanged)
--   description -> description  (unchanged)
--   priority    -> priority     now task_priority enum: low|medium|high
--   dueDate     -> due_at       now timestamptz; the app previously stored a
--                               bare "YYYY-MM-DD" string with no timezone,
--                               which cannot be compared reliably
--   completed   -> status       boolean becomes a lifecycle enum. The boolean
--                               is still derivable as status = 'done', and
--                               completed_at records *when* it happened, which
--                               the boolean could not express
--
-- Deliberately NOT created: a separate table per task concept. Habit, fitness,
-- study, shopping and meeting modes each get their own table later only if they
-- need their own relational state; anything that is simply a titled, completed
-- record belongs in tasks or in the general record system.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- task_categories
--
-- Workspace-scoped rather than global so two teams can use different
-- taxonomies (e.g. "Backend" for engineering, "Rent" for a household) without
-- colliding.
-- ---------------------------------------------------------------------------
create table if not exists public.task_categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint task_categories_name_not_blank
    check (char_length(btrim(name)) > 0),
  constraint task_categories_name_length
    check (char_length(name) <= 120),

  -- Required so child rows can carry a composite (workspace_id, id) foreign key,
  -- which is what stops a task being linked to another workspace's category.
  constraint task_categories_workspace_id_id_key unique (workspace_id, id),
  constraint task_categories_name_unique_per_workspace
    unique (workspace_id, name)
);

comment on table public.task_categories is
  'Workspace-scoped labels for organising tasks.';

drop trigger if exists task_categories_set_updated_at on public.task_categories;
  create trigger task_categories_set_updated_at
  before update on public.task_categories
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,

  -- Core searchable fields stay relational columns rather than hiding inside
  -- JSONB, so they are indexable, sortable and comparable in SQL.
  title text not null,
  description text,

  status public.task_status not null default 'todo',
  priority public.task_priority not null default 'medium',

  -- Proper timestamp, not the "YYYY-MM-DD" string the client previously stored.
  due_at timestamptz,

  -- Set automatically on transition into 'done' by the trigger below.
  completed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tasks_title_not_blank
    check (char_length(btrim(title)) > 0),
  constraint tasks_title_length
    check (char_length(title) <= 500),

  -- A completed task must record when it completed. This removes the
  -- "done but no timestamp" state that would corrupt completion analytics.
  constraint tasks_completed_at_required_when_done
    check (status <> 'done' or completed_at is not null),

  constraint tasks_workspace_id_id_key unique (workspace_id, id)
);

comment on table public.tasks is
  'Task record. Maps to Structra''s TaskItem; completed boolean is replaced by status plus completed_at.';

drop trigger if exists tasks_set_updated_at on public.tasks;
  create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- Maintains completed_at as a function of status so it can never drift.
-- Entering 'done' stamps the moment; every other transition leaves the existing
-- value alone so the *last* completion time survives reopening.
create or replace function public.tasks_sync_completed_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    new.completed_at := coalesce(new.completed_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_sync_completed_at on public.tasks;
  create trigger tasks_sync_completed_at
  before insert or update of status on public.tasks
  for each row execute function public.tasks_sync_completed_at();


-- ---------------------------------------------------------------------------
-- task_category_links
--
-- Carries workspace_id so both parents can be enforced via composite foreign
-- keys. Without it, a task in workspace A could be tagged with a category from
-- workspace B - a cross-tenant leak that row-level policy alone would not
-- prevent, because RLS checks rows independently and never joins.
-- ---------------------------------------------------------------------------
create table if not exists public.task_category_links (
  task_id uuid not null,
  category_id uuid not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_at timestamptz not null default now(),

  constraint task_category_links_pk primary key (task_id, category_id),

  constraint task_category_links_task_fk
    foreign key (workspace_id, task_id)
    references public.tasks (workspace_id, id) on delete cascade,

  constraint task_category_links_category_fk
    foreign key (workspace_id, category_id)
    references public.task_categories (workspace_id, id) on delete cascade
);

comment on table public.task_category_links is
  'Many-to-many task/category assignment. workspace_id is carried specifically to allow composite foreign keys that prevent cross-workspace tagging.';

create index if not exists task_category_links_category_id_idx
  on public.task_category_links (category_id);