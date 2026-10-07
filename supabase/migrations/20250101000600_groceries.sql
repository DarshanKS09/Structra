-- ===========================================================================
-- Structra :: 00600 - Groceries
--
--   grocery_lists   named lists, reusable across trips
--   grocery_items   the line items
--
-- Reconciliation with the existing Structra GroceryItem:
--
-- The app stores a flat, mode-wide list of {itemName, quantity, unit,
-- purchased}. There is no list, so nothing distinguishes "this week's shop"
-- from "top-up run", and clearing after a purchase means either deleting rows
-- (losing what was bought) or filtering them out permanently.
--
-- grocery_lists adds that missing grouping. `completed` here maps directly to
-- the app's `purchased` boolean, and the unit enum reuses the app's existing
-- union values exactly.
--
-- Note on units: quantity is stored as numeric with unit as a separate enum
-- column. Quantities are NOT summed across differing units in the schema -
-- 2 kg and 500 g are different measures, and merging them would be a silent
-- correctness bug. Any such normalisation belongs in an explicit application
-- function, not in a trigger.
-- ===========================================================================

create table if not exists public.grocery_lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint grocery_lists_name_not_blank
    check (char_length(btrim(name)) > 0),
  constraint grocery_lists_name_length
    check (char_length(name) <= 120)
);

comment on table public.grocery_lists is
  'Named grocery list. Adds the grouping the previous single flat list lacked.';

drop trigger if exists grocery_lists_set_updated_at on public.grocery_lists;
  create trigger grocery_lists_set_updated_at
  before update on public.grocery_lists
  for each row execute function public.set_updated_at();

create index if not exists grocery_lists_workspace_id_idx
  on public.grocery_lists (workspace_id);


-- ---------------------------------------------------------------------------
-- grocery_items
--
-- No workspace_id column, per the agreed column list. Membership is resolved
-- through the parent list by can_access_grocery_list(), which keeps a single
-- source of truth for tenancy instead of duplicating it on every row where it
-- could drift out of sync with the parent.
-- ---------------------------------------------------------------------------
create table if not exists public.grocery_items (
  id uuid primary key default gen_random_uuid(),
  grocery_list_id uuid not null references public.grocery_lists (id) on delete cascade,

  name text not null,

  -- numeric rather than float, so quantities are exact.
  quantity numeric(12, 3),

  unit public.grocery_unit,

  -- Maps to the app's `purchased` flag.
  completed boolean not null default false,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint grocery_items_name_not_blank
    check (char_length(btrim(name)) > 0),
  constraint grocery_items_name_length
    check (char_length(name) <= 200),

  -- Negative quantities are meaningless for a shopping list.
  constraint grocery_items_quantity_non_negative
    check (quantity is null or quantity >= 0),

  -- A quantity without a unit is ambiguous, so require them together.
  constraint grocery_items_quantity_requires_unit
    check ((quantity is null) = (unit is null))
);

comment on table public.grocery_items is
  'A single grocery line item. completed corresponds to the app''s purchased flag.';

drop trigger if exists grocery_items_set_updated_at on public.grocery_items;
  create trigger grocery_items_set_updated_at
  before update on public.grocery_items
  for each row execute function public.set_updated_at();

-- Serves both the per-list read and "what is left to buy".
create index if not exists grocery_items_list_id_idx
  on public.grocery_items (grocery_list_id);

create index if not exists grocery_items_list_completed_idx
  on public.grocery_items (grocery_list_id, completed);

-- Used by grocery_items, whose RLS must resolve membership through its parent
-- list rather than carrying its own workspace_id column.
create or replace function public.can_access_grocery_list(target_list_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.grocery_lists gl
    where gl.id = target_list_id
      and public.is_workspace_member(gl.workspace_id)
  );
$$;

comment on function public.is_workspace_member(uuid) is
  'True when the calling user (auth.uid()) has any membership row in the given workspace. SECURITY DEFINER to avoid RLS recursion on workspace_members.';

comment on function public.has_workspace_role(uuid, public.workspace_role[]) is
  'True when the calling user holds one of the given roles in the workspace.';

comment on function public.is_workspace_owner(uuid) is
  'True when the calling user is the owner of the workspace.';

comment on function public.shares_workspace_with(uuid) is
  'True when the calling user and the given user share at least one workspace. Used for profile visibility.';

comment on function public.can_access_grocery_list(uuid) is
  'True when the calling user may access the given grocery list.';
