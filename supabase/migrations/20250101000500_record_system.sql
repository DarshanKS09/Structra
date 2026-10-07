-- ===========================================================================
-- Structra :: 00500 - General record system
--
--   record_types       user-defined types ("Plant", "Book", "Expense")
--   record_categories  workspace-scoped taxonomy
--   records            the instances
--
-- DESIGN RULE: records are NOT a JSON document store.
--
-- Everything that can be queried, joined, filtered, sorted or authorised stays
-- a real column with a real type:
--
--   workspace_id    tenancy + RLS
--   created_by      ownership
--   record_type_id  the type relationship
--   category_id     taxonomy
--   title           the searchable name
--   created_at / updated_at / archived_at
--
-- `data` JSONB holds ONLY the type-specific custom fields that vary per record
-- type. It is deliberately constrained to a JSON object (see the check below) so
-- it cannot degenerate into an array or a scalar blob, and it is never used for
-- anything that needs an index.
--
-- The result: adding a new kind of tracking for a user never requires a
-- migration, while the columns that matter for security and search stay
-- relational and indexable.
-- ===========================================================================

create table if not exists public.record_types (
  id uuid primary key default gen_random_uuid(),

  -- NULL workspace_id defines a global/system type available to every user.
  -- A non-null workspace_id defines a private type. This is what allows useful
  -- built-in types to be shipped by migration while still supporting custom
  -- per-workspace types.
  workspace_id uuid references public.workspaces (id) on delete cascade,

  name text not null,
  description text,
  created_by uuid references auth.users (id) on delete set null,

  -- Field definitions for the custom fields stored in records.data, e.g.
  --   [{"key":"watered_on","label":"Last watered","type":"date","required":false}]
  -- Present because rendering a record form and validating its input genuinely
  -- require it. Kept nullable so a type with no custom fields costs nothing.
  configuration jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint record_types_name_not_blank
    check (char_length(btrim(name)) > 0),
  constraint record_types_name_length
    check (char_length(name) <= 120),

  -- Must be a JSON object, never an array or scalar.
  constraint record_types_configuration_is_object
    check (configuration is null or jsonb_typeof(configuration) = 'object'),

  -- A global type cannot be attributed to a creator's workspace, and a
  -- workspace type must have a creator context.
  constraint record_types_global_has_no_creator
    check (workspace_id is not null or created_by is null)
);

comment on table public.record_types is
  'User-defined record types. workspace_id NULL means a global/system type shared by all users.';

drop trigger if exists record_types_set_updated_at on public.record_types;
  create trigger record_types_set_updated_at
  before update on public.record_types
  for each row execute function public.set_updated_at();

-- Uniqueness must be expressed as two partial indexes because a plain
-- UNIQUE (workspace_id, name) does not constrain NULL workspace_id rows:
-- in SQL, NULLs are distinct, so several global types could share a name.
create unique index if not exists record_types_name_unique_global
  on public.record_types (name)
  where workspace_id is null;

create unique index if not exists record_types_name_unique_per_workspace
  on public.record_types (workspace_id, name)
  where workspace_id is not null;


-- ---------------------------------------------------------------------------
-- record_categories
-- ---------------------------------------------------------------------------
create table if not exists public.record_categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint record_categories_name_not_blank
    check (char_length(btrim(name)) > 0),
  constraint record_categories_name_length
    check (char_length(name) <= 120),

  constraint record_categories_workspace_id_id_key unique (workspace_id, id),
  constraint record_categories_name_unique_per_workspace
    unique (workspace_id, name)
);

comment on table public.record_categories is
  'Workspace-scoped taxonomy shared by all record types.';

drop trigger if exists record_categories_set_updated_at on public.record_categories;
  create trigger record_categories_set_updated_at
  before update on public.record_categories
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- records
-- ---------------------------------------------------------------------------
create table if not exists public.records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,

  -- A global type (workspace_id NULL) is also permitted, which is why this is a
  -- plain FK rather than a composite one. Cross-workspace consistency is
  -- enforced by the trigger below instead.
  record_type_id uuid not null references public.record_types (id) on delete restrict,

  category_id uuid references public.record_categories (id) on delete set null,

  -- Promoted out of JSONB precisely so records are searchable and sortable
  -- without JSON operators.
  title text not null,
  description text,

  -- Custom, type-specific fields ONLY.
  data jsonb not null default '{}'::jsonb,

  created_by uuid not null references auth.users (id) on delete cascade,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,

  constraint records_title_not_blank
    check (char_length(btrim(title)) > 0),
  constraint records_title_length
    check (char_length(title) <= 500),

  -- The guard that keeps records from becoming an unstructured JSON database:
  -- data must be an object, never an array or a bare scalar.
  constraint records_data_is_object
    check (jsonb_typeof(data) = 'object'),

  constraint records_created_at_not_future
    check (created_at <= now() + interval '1 day')
);

comment on table public.records is
  'Instances of a record type. Ownership, relationships and searchable fields are relational; only custom fields live in the data JSONB column.';

drop trigger if exists records_set_updated_at on public.records;
  create trigger records_set_updated_at
  before update on public.records
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- Cross-workspace integrity
--
-- RLS evaluates each row independently and never joins, so a policy alone cannot
-- stop a record being written with a category or type belonging to a different
-- workspace. This trigger closes that hole at the storage layer, so the
-- invariant holds regardless of which client wrote the row.
-- ---------------------------------------------------------------------------
create or replace function public.records_enforce_workspace_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  type_workspace uuid;
  category_workspace uuid;
begin
  select rt.workspace_id into type_workspace
  from public.record_types rt
  where rt.id = new.record_type_id;

  if type_workspace is not null and type_workspace <> new.workspace_id then
    raise exception
      'record_type_id % belongs to a different workspace', new.record_type_id
      using errcode = '23514';
  end if;

  if new.category_id is not null then
    select rc.workspace_id into category_workspace
    from public.record_categories rc
    where rc.id = new.category_id;

    if category_workspace is distinct from new.workspace_id then
      raise exception
        'category_id % does not belong to workspace %', new.category_id, new.workspace_id
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists records_enforce_workspace_consistency on public.records;
  create trigger records_enforce_workspace_consistency
  before insert or update of record_type_id, category_id, workspace_id
  on public.records
  for each row execute function public.records_enforce_workspace_consistency();

comment on function public.records_enforce_workspace_consistency() is
  'Rejects records whose record_type or category belongs to another workspace. SECURITY DEFINER so the check is not blocked by RLS on the referenced tables.';