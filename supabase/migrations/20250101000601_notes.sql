-- ===========================================================================
-- Structra :: 00600b - Notes
--
--   notes   personal notes, workspace-scoped
--
-- RECONCILIATION - why notes is a table and not a record type:
--
-- Structra has a "Meeting Notes" mode, so notes are an existing concept rather
-- than a hypothetical one. But notes are NOT the same thing as the general
-- record system, and the boundary matters:
--
--   notes          first-class, always available, known shape, owned by a user,
--                  reachable from the dashboard
--   record system  user-defined types the user creates for themselves
--
-- Modelling notes as a built-in record type would mean every user needs a
-- "Note" record type created before they can take a note, and every note would
-- be an indirect join away. Keeping notes relational keeps the common case fast
-- and simple while the record system stays genuinely extensible.
--
-- SCOPE NOTE: Structra's MeetingItem also carries `participants` and a meeting
-- `date`. Those are meeting-specific metadata and are deliberately NOT modelled
-- here - inventing a meetings table was out of scope, and they can be captured
-- by a "Meeting" record type with participant fields in its configuration if
-- that proves necessary. Flagged for a later decision rather than guessed at.
-- ---------------------------------------------------------------------------

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,

  -- Personal ownership. Distinct from workspace_id: a note belongs to a
  -- workspace but to one author within it.
  user_id uuid not null references auth.users (id) on delete cascade,

  title text not null,
  content text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Soft delete so a note is recoverable rather than permanently destroyed.
  archived_at timestamptz,

  constraint notes_title_not_blank
    check (char_length(btrim(title)) > 0),
  constraint notes_title_length
    check (char_length(title) <= 500),

  constraint notes_archived_at_is_timestamp
    check (archived_at is null or archived_at >= created_at)
);

comment on table public.notes is
  'Personal note within a workspace. Structra''s Meeting Notes mode maps here; meeting-specific metadata is intentionally out of scope.';

drop trigger if exists notes_set_updated_at on public.notes;
  create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

create index if not exists notes_workspace_id_idx on public.notes (workspace_id);

create index if not exists notes_user_id_idx on public.notes (user_id);

-- Serves the default query: "my active notes in this workspace, newest first".
create index if not exists notes_active_idx
  on public.notes (workspace_id, user_id, created_at desc)
  where archived_at is null;