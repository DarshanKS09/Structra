-- ===========================================================================
-- Structra :: 00000 - Foundations
--
-- Extensions, shared trigger functions, authorisation helper functions and
-- the enumerated domains used by later migrations.
--
-- This migration is deliberately infrastructure-only: it creates no tables, so
-- it is safe to re-run and depends on nothing else.
-- ===========================================================================

-- pg_trgm provides trigram indexes, used in a later migration for the
-- substring search that Structra's UI already exposes on tasks and records.
-- Idempotent: required on a fresh project, harmless on an existing one.
create extension if not exists pg_trgm with schema extensions;


-- ---------------------------------------------------------------------------
-- GENERIC TIMESTAMPS
-- ---------------------------------------------------------------------------

-- Single definition of "now" so every table agrees on precision and type.
-- timestamptz throughout; no date/time is ever stored as text.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger assigning new.updated_at = now(). Attached to every table that carries updated_at.';


-- ---------------------------------------------------------------------------
-- ENUMERATED DOMAINS
--
-- Enums rather than CHECK constraints, deliberately: PostgREST surfaces them as
-- true TypeScript string unions in generated types, whereas a CHECK constraint
-- degrades to a bare `string` and provides no compile-time safety in the app.
--
-- The grocery unit and habit frequency values are byte-identical to the values
-- Structra's TypeScript unions already use, so no client-side mapping is needed.
-- ---------------------------------------------------------------------------

-- Access level within a workspace. 'owner' implies all privileges.
do $$ begin
  create type public.workspace_role as enum (  'owner', 'admin', 'member');
exception
  when duplicate_object then null;
end $$;

-- Lifecycle of a task. Structra's current boolean `completed` maps to 'done'.
do $$ begin
  create type public.task_status as enum (  
    'todo',
    'in_progress',
    'blocked',
    'done',
    'archived'
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.task_priority as enum (  'low', 'medium', 'high');
exception
  when duplicate_object then null;
end $$;

-- Structra's existing GroceryItem["unit"] union, unchanged.
do $$ begin
  create type public.grocery_unit as enum (  'kg', 'g', 'pieces', 'liters');
exception
  when duplicate_object then null;
end $$;

-- Structra's existing HabitItem["frequency"] union, unchanged.
do $$ begin
  create type public.habit_frequency as enum (  'daily', 'weekly');
exception
  when duplicate_object then null;
end $$;

-- Structra's existing ThemeVariant union, unchanged. Constraining the column
-- to these three values means an unsupported theme cannot be persisted.
do $$ begin
  create type public.app_theme as enum (  'ocean', 'crimson', 'light');
exception
  when duplicate_object then null;
end $$;