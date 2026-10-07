-- ===========================================================================
-- Structra :: 00800 - Row Level Security
--
-- RLS is enabled on every application table, then policies are attached.
--
-- Model:
--
--   read    any member of the owning workspace
--   write   any member of the owning workspace
--   delete  the creating user, or a workspace owner/admin
--
-- Every policy is bound to `auth.uid()`, so a user cannot reach another user's
-- rows by editing a UUID in a request. There is no `using (true)` anywhere:
-- a policy that permits everything disables the protection RLS exists to
-- provide, and RLS-enabled tables are only actually protected while at least
-- one policy exists.
--
-- Ownership tables (profiles, user_settings) are restricted to their owner,
-- except that a profile is readable by anyone who shares a workspace with it,
-- which is required to render member lists.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- ENABLE RLS
--
-- Declared up front for every table. Enabling before the policies exist means
-- there is no window in which a table is reachable without restriction.
-- ---------------------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.workspaces           enable row level security;
alter table public.workspace_members    enable row level security;
alter table public.task_categories      enable row level security;
alter table public.task_category_links  enable row level security;
alter table public.tasks                enable row level security;
alter table public.habits               enable row level security;
alter table public.habit_completions    enable row level security;
alter table public.study_subjects       enable row level security;
alter table public.study_sessions       enable row level security;
alter table public.record_types         enable row level security;
alter table public.record_categories    enable row level security;
alter table public.records              enable row level security;
alter table public.grocery_lists        enable row level security;
alter table public.grocery_items        enable row level security;
alter table public.notes                enable row level security;
alter table public.user_settings        enable row level security;

-- Defence in depth. `authenticator` is the role PostgREST connects as; it must
-- not bypass RLS. The table owner (postgres) bypasses it, which is what allows
-- the SECURITY DEFINER helper functions and the signup trigger to work.
alter table public.workspaces        force row level security;
alter table public.workspace_members force row level security;


-- ===========================================================================
-- profiles
-- ===========================================================================

drop policy if exists profiles_select_self_or_shared_workspace on public.profiles;
create policy profiles_select_self_or_shared_workspace
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.shares_workspace_with(id));

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No DELETE policy: deleting a profile is handled by cascading from
-- auth.users. A user cannot delete their own profile row independently.


-- ===========================================================================
-- workspaces
-- ===========================================================================

drop policy if exists workspaces_select_member on public.workspaces;
create policy workspaces_select_member
  on public.workspaces for select
  to authenticated
  using (public.is_workspace_member(id));

-- A user may create a workspace only if they are its declared owner.
drop policy if exists workspaces_insert_owner on public.workspaces;
create policy workspaces_insert_owner
  on public.workspaces for insert
  to authenticated
  with check (owner_id = auth.uid());

drop policy if exists workspaces_update_owner on public.workspaces;
create policy workspaces_update_owner
  on public.workspaces for update
  to authenticated
  using (public.is_workspace_owner(id))
  with check (public.is_workspace_owner(id));

drop policy if exists workspaces_delete_owner on public.workspaces;
create policy workspaces_delete_owner
  on public.workspaces for delete
  to authenticated
  using (public.is_workspace_owner(id));


-- ===========================================================================
-- workspace_members
--
-- Reads go through public.is_workspace_member(), a SECURITY DEFINER function.
-- Writing these rows directly with an inline `exists (select ... from
-- workspace_members ...)` would recurse infinitely, because the policy's own
-- table would need to be readable under the policy.
-- ===========================================================================

drop policy if exists workspace_members_select_member on public.workspace_members;
create policy workspace_members_select_member
  on public.workspace_members for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

-- Only an owner may add members, and the row must grant a role the adder
-- actually holds: an admin must not be able to mint a second owner.
drop policy if exists workspace_members_insert_owner on public.workspace_members;
create policy workspace_members_insert_owner
  on public.workspace_members for insert
  to authenticated
  with check (
    public.is_workspace_owner(workspace_id)
    and (role = 'member' or role = 'admin' or public.is_workspace_owner(workspace_id))
  );

drop policy if exists workspace_members_update_owner on public.workspace_members;
create policy workspace_members_update_owner
  on public.workspace_members for update
  to authenticated
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

-- Owners/admins may remove anyone; any member may remove themselves, which is
-- how a user leaves a workspace they were invited to.
drop policy if exists workspace_members_delete_owner_or_self on public.workspace_members;
create policy workspace_members_delete_owner_or_self
  on public.workspace_members for delete
  to authenticated
  using (
    public.is_workspace_owner(workspace_id)
    or user_id = auth.uid()
  );


-- ===========================================================================
-- Workspace-scoped tables
--
-- The four policies below are repeated per table. PostgreSQL has no policy
-- inheritance, so this repetition is structural rather than avoidable, and each
-- copy is explicit so that no table can be left with a policy missing.
-- ===========================================================================

-- ---------------------------------------------------------------- tasks
drop policy if exists tasks_select_member on public.tasks;
create policy tasks_select_member
  on public.tasks for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists tasks_insert_member on public.tasks;
create policy tasks_insert_member
  on public.tasks for insert to authenticated
  with check (
    public.is_workspace_member(workspace_id)
    -- A row must claim the authenticated user as its author.
    and created_by = auth.uid()
  );

drop policy if exists tasks_update_member on public.tasks;
create policy tasks_update_member
  on public.tasks for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists tasks_delete_creator_or_admin on public.tasks;
create policy tasks_delete_creator_or_admin
  on public.tasks for delete to authenticated
  using (
    created_by = auth.uid()
    or public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
  );

-- ------------------------------------------------------- task_categories
drop policy if exists task_categories_select_member on public.task_categories;
create policy task_categories_select_member
  on public.task_categories for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists task_categories_insert_member on public.task_categories;
create policy task_categories_insert_member
  on public.task_categories for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

drop policy if exists task_categories_update_member on public.task_categories;
create policy task_categories_update_member
  on public.task_categories for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists task_categories_delete_member on public.task_categories;
create policy task_categories_delete_member
  on public.task_categories for delete to authenticated
  using (public.is_workspace_member(workspace_id));

-- --------------------------------------------------- task_category_links
-- Authorisation resolves through the parent task, since the link row itself
-- carries no created_by.
drop policy if exists task_category_links_select_member on public.task_category_links;
create policy task_category_links_select_member
  on public.task_category_links for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists task_category_links_insert_member on public.task_category_links;
create policy task_category_links_insert_member
  on public.task_category_links for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

drop policy if exists task_category_links_delete_member on public.task_category_links;
create policy task_category_links_delete_member
  on public.task_category_links for delete to authenticated
  using (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------- habits
drop policy if exists habits_select_member on public.habits;
create policy habits_select_member
  on public.habits for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists habits_insert_member on public.habits;
create policy habits_insert_member
  on public.habits for insert to authenticated
  with check (
    public.is_workspace_member(workspace_id)
    and created_by = auth.uid()
  );

drop policy if exists habits_update_member on public.habits;
create policy habits_update_member
  on public.habits for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists habits_delete_creator_or_admin on public.habits;
create policy habits_delete_creator_or_admin
  on public.habits for delete to authenticated
  using (
    created_by = auth.uid()
    or public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
  );

-- ----------------------------------------------------- habit_completions
drop policy if exists habit_completions_select_member on public.habit_completions;
create policy habit_completions_select_member
  on public.habit_completions for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists habit_completions_insert_member on public.habit_completions;
create policy habit_completions_insert_member
  on public.habit_completions for insert to authenticated
  with check (
    public.is_workspace_member(workspace_id)
    and user_id = auth.uid()
  );

drop policy if exists habit_completions_update_member on public.habit_completions;
create policy habit_completions_update_member
  on public.habit_completions for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists habit_completions_delete_own on public.habit_completions;
create policy habit_completions_delete_own
  on public.habit_completions for delete to authenticated
  using (
    user_id = auth.uid()
    or public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
  );

-- -------------------------------------------------------- study_subjects
drop policy if exists study_subjects_select_member on public.study_subjects;
create policy study_subjects_select_member
  on public.study_subjects for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists study_subjects_insert_member on public.study_subjects;
create policy study_subjects_insert_member
  on public.study_subjects for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

drop policy if exists study_subjects_update_member on public.study_subjects;
create policy study_subjects_update_member
  on public.study_subjects for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists study_subjects_delete_member on public.study_subjects;
create policy study_subjects_delete_member
  on public.study_subjects for delete to authenticated
  using (public.is_workspace_member(workspace_id));

-- -------------------------------------------------------- study_sessions
drop policy if exists study_sessions_select_member on public.study_sessions;
create policy study_sessions_select_member
  on public.study_sessions for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists study_sessions_insert_member on public.study_sessions;
create policy study_sessions_insert_member
  on public.study_sessions for insert to authenticated
  with check (
    public.is_workspace_member(workspace_id)
    and user_id = auth.uid()
  );

drop policy if exists study_sessions_update_member on public.study_sessions;
create policy study_sessions_update_member
  on public.study_sessions for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists study_sessions_delete_own on public.study_sessions;
create policy study_sessions_delete_own
  on public.study_sessions for delete to authenticated
  using (
    user_id = auth.uid()
    or public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
  );

-- --------------------------------------------------------- record_types
-- Global types (workspace_id IS NULL) are readable by every authenticated user,
-- which is how built-in types ship without a migration per workspace.
drop policy if exists record_types_select_global_or_member on public.record_types;
create policy record_types_select_global_or_member
  on public.record_types for select to authenticated
  using (workspace_id is null or public.is_workspace_member(workspace_id));

-- Users may only create their own workspace-scoped types, never global ones.
drop policy if exists record_types_insert_member on public.record_types;
create policy record_types_insert_member
  on public.record_types for insert to authenticated
  with check (
    workspace_id is not null
    and public.is_workspace_member(workspace_id)
    and created_by = auth.uid()
  );

drop policy if exists record_types_update_member on public.record_types;
create policy record_types_update_member
  on public.record_types for update to authenticated
  using (workspace_id is not null and public.is_workspace_member(workspace_id))
  with check (workspace_id is not null and public.is_workspace_member(workspace_id));

drop policy if exists record_types_delete_creator_or_admin on public.record_types;
create policy record_types_delete_creator_or_admin
  on public.record_types for delete to authenticated
  using (
    created_by = auth.uid()
    or public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
  );

-- ----------------------------------------------------- record_categories
drop policy if exists record_categories_select_member on public.record_categories;
create policy record_categories_select_member
  on public.record_categories for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists record_categories_insert_member on public.record_categories;
create policy record_categories_insert_member
  on public.record_categories for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

drop policy if exists record_categories_update_member on public.record_categories;
create policy record_categories_update_member
  on public.record_categories for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists record_categories_delete_member on public.record_categories;
create policy record_categories_delete_member
  on public.record_categories for delete to authenticated
  using (public.is_workspace_member(workspace_id));

-- --------------------------------------------------------------- records
drop policy if exists records_select_member on public.records;
create policy records_select_member
  on public.records for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists records_insert_member on public.records;
create policy records_insert_member
  on public.records for insert to authenticated
  with check (
    public.is_workspace_member(workspace_id)
    and created_by = auth.uid()
  );

drop policy if exists records_update_member on public.records;
create policy records_update_member
  on public.records for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists records_delete_creator_or_admin on public.records;
create policy records_delete_creator_or_admin
  on public.records for delete to authenticated
  using (
    created_by = auth.uid()
    or public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
  );

-- -------------------------------------------------------- grocery_lists
drop policy if exists grocery_lists_select_member on public.grocery_lists;
create policy grocery_lists_select_member
  on public.grocery_lists for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists grocery_lists_insert_member on public.grocery_lists;
create policy grocery_lists_insert_member
  on public.grocery_lists for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

drop policy if exists grocery_lists_update_member on public.grocery_lists;
create policy grocery_lists_update_member
  on public.grocery_lists for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists grocery_lists_delete_member on public.grocery_lists;
create policy grocery_lists_delete_member
  on public.grocery_lists for delete to authenticated
  using (public.is_workspace_member(workspace_id));

-- -------------------------------------------------------- grocery_items
-- Membership is resolved via the parent list, because grocery_items
-- intentionally carries no workspace_id column.
drop policy if exists grocery_items_select_via_list on public.grocery_items;
create policy grocery_items_select_via_list
  on public.grocery_items for select to authenticated
  using (public.can_access_grocery_list(grocery_list_id));

drop policy if exists grocery_items_insert_via_list on public.grocery_items;
create policy grocery_items_insert_via_list
  on public.grocery_items for insert to authenticated
  with check (public.can_access_grocery_list(grocery_list_id));

drop policy if exists grocery_items_update_via_list on public.grocery_items;
create policy grocery_items_update_via_list
  on public.grocery_items for update to authenticated
  using (public.can_access_grocery_list(grocery_list_id))
  with check (public.can_access_grocery_list(grocery_list_id));

drop policy if exists grocery_items_delete_via_list on public.grocery_items;
create policy grocery_items_delete_via_list
  on public.grocery_items for delete to authenticated
  using (public.can_access_grocery_list(grocery_list_id));

-- ----------------------------------------------------------------- notes
drop policy if exists notes_select_member on public.notes;
create policy notes_select_member
  on public.notes for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists notes_insert_member on public.notes;
create policy notes_insert_member
  on public.notes for insert to authenticated
  with check (
    public.is_workspace_member(workspace_id)
    and user_id = auth.uid()
  );

drop policy if exists notes_update_member on public.notes;
create policy notes_update_member
  on public.notes for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists notes_delete_own on public.notes;
create policy notes_delete_own
  on public.notes for delete to authenticated
  using (
    user_id = auth.uid()
    or public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[])
  );

-- --------------------------------------------------------- user_settings
-- Strictly owner-only: preferences are not shared with anyone.
drop policy if exists user_settings_select_own on public.user_settings;
create policy user_settings_select_own
  on public.user_settings for select to authenticated
  using (user_id = auth.uid());

drop policy if exists user_settings_insert_own on public.user_settings;
create policy user_settings_insert_own
  on public.user_settings for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists user_settings_update_own on public.user_settings;
create policy user_settings_update_own
  on public.user_settings for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists user_settings_delete_own on public.user_settings;
create policy user_settings_delete_own
  on public.user_settings for delete to authenticated
  using (user_id = auth.uid());