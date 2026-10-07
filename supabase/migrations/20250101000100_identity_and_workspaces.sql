-- ===========================================================================
-- Structra :: 00100 - Identity and workspaces
--
--   profiles           1:1 mirror of auth.users, holds presentation data
--   workspaces         the tenancy boundary; every application row hangs off one
--   workspace_members  who may read/write a workspace, and in which role
--
-- No application data table exists without a workspace_id, so a single
-- membership check secures the whole schema.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- profiles
--
-- Keyed directly on auth.users(id). The FK means a deleted auth user cannot
-- leave an orphaned profile, and an application insert cannot invent a profile
-- for a user that does not exist.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_display_name_length
    check (display_name is null or char_length(display_name) <= 120),

  -- Free-form IANA zone names ("Asia/Kolkata", "UTC"). Validated for shape
  -- only: the zone catalogue lives in pg_timezone_names and can be extended by
  -- Postgres upgrades, so a hard CHECK against it would break the app on a
  -- timezone database update.
  constraint profiles_timezone_shape
    check (timezone ~ '^[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+)*$|^UTC$')
);

comment on table public.profiles is
  'Presentation data for an authenticated user, 1:1 with auth.users.';

drop trigger if exists profiles_set_updated_at on public.profiles;
  create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- workspaces
--
-- `is_personal` marks the auto-created private workspace. It is not merely
-- cosmetic: the partial unique index below is what makes personal-workspace
-- creation idempotent at the database level, so a retried signup can never
-- produce two personal workspaces for one user.
-- ---------------------------------------------------------------------------
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  is_personal boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint workspaces_name_not_blank
    check (char_length(btrim(name)) > 0),
  constraint workspaces_name_length
    check (char_length(name) <= 120)
);

comment on table public.workspaces is
  'Tenancy boundary. Every application row belongs to exactly one workspace. is_personal marks the auto-created private workspace.';

drop trigger if exists workspaces_set_updated_at on public.workspaces;
  create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

-- At most one personal workspace per owner. Enforced here rather than only in
-- application code so that concurrent signups cannot both win a race.
create unique index if not exists workspaces_one_personal_per_owner
  on public.workspaces (owner_id)
  where is_personal;

-- Supports the "workspaces I own" query and the cascade from auth.users.
create index if not exists workspaces_owner_id_idx on public.workspaces (owner_id);


-- ---------------------------------------------------------------------------
-- workspace_members
--
-- Membership is the authorisation source of truth. `is_workspace_member()` and
-- friends read this table through SECURITY DEFINER functions, so RLS on this
-- table cannot recurse.
--
-- UNIQUE (workspace_id, user_id) makes membership idempotent: re-inviting an
-- existing member updates rather than duplicating.
-- ---------------------------------------------------------------------------
create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.workspace_role not null default 'member',
  created_at timestamptz not null default now(),

  constraint workspace_members_unique_membership
    unique (workspace_id, user_id),

  -- Every workspace must retain at least one owner. Enforced by a trigger in
  -- the 01000 migration so that deleting the last owner is rejected while
  -- still allowing the workspace itself to be deleted.
  constraint workspace_members_role_valid
    check (role in ('owner', 'admin', 'member'))
);

comment on table public.workspace_members is
  'Authorisation source of truth. Rows here grant access to every table scoped by workspace_id.';

-- Membership lookups are the hottest RLS predicate in the schema.
create index if not exists workspace_members_user_id_idx on public.workspace_members (user_id);

-- Serves "list my workspaces" and the workspace_members SELECT policy.
create index if not exists workspace_members_workspace_id_idx
  on public.workspace_members (workspace_id, user_id);

-- ---------------------------------------------------------------------------
-- AUTHORISATION HELPERS
--
-- These are SECURITY DEFINER on purpose.
--
-- workspace_members has its own RLS policy that must read workspace_members.
-- Without elevated rights that policy would recurse infinitely
-- ("infinite recursion detected in policy"), which is the single most common
-- Supabase RLS failure mode. Reading membership from a SECURITY DEFINER
-- function breaks the cycle because function execution is not itself filtered
-- by the calling query's policies.
--
-- `set search_path = ''` is mandatory for SECURITY DEFINER functions: it stops
-- a caller from hijacking name resolution to run code as the definer.
--
-- Every function is STABLE (single statement, no writes) so the planner can
-- evaluate it once per query.
-- ---------------------------------------------------------------------------

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
  );
$$;

create or replace function public.has_workspace_role(
  target_workspace_id uuid,
  allowed_roles public.workspace_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.role = any (allowed_roles)
  );
$$;

create or replace function public.is_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.role = 'owner'::public.workspace_role
  );
$$;

create or replace function public.shares_workspace_with(other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs
      on theirs.workspace_id = mine.workspace_id
    where mine.user_id = auth.uid()
      and theirs.user_id = other_user_id
  );
$$;
