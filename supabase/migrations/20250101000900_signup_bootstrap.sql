-- ===========================================================================
-- Structra :: 00900 - Signup bootstrap
--
-- Guarantees that every authenticated user ends up with, exactly once:
--   1. a profile
--   2. a personal workspace
--   3. an owner membership row in that workspace
--
-- Implemented as an AFTER INSERT trigger on auth.users rather than as
-- application code, so the guarantee holds no matter how the user was created:
-- password signup, OAuth, magic link, SSO, or a row inserted directly by an
-- admin. Doing this in the client would leave any non-browser path without a
-- workspace.
--
-- IDEMPOTENCY: every insert uses ON CONFLICT DO NOTHING, and the function is
-- additionally guarded by the workspaces_one_personal_per_owner partial unique
-- index. Re-running the trigger cannot produce duplicates.
--
-- SECURITY DEFINER is required: the trigger runs as the function owner, not as
-- the new user, so it can write rows that the user's own RLS context could not
-- yet authorise (a brand-new user is not yet a member of the workspace the row
-- is being created in).
-- ===========================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_workspace_id uuid;
  resolved_name text;
begin
  -- Prefer the name Supabase Auth already collected, then the email local part,
  -- then a neutral default. Never fails on a missing name.
  resolved_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), ''),
    'My Workspace'
  );

  -- 1. Profile. ON CONFLICT DO NOTHING keeps a manually created profile.
  insert into public.profiles (id, display_name, avatar_url, timezone)
  values (
    new.id,
    left(resolved_name, 120),
    nullif(btrim(new.raw_user_meta_data ->> 'avatar_url'), ''),
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'timezone'), ''), 'UTC')
  )
  on conflict (id) do nothing;

  -- 2. Personal workspace. Only one per user, enforced by the partial unique
  --    index, so the DO NOTHING branch below is what makes a retried signup
  --    safe.
  insert into public.workspaces (name, owner_id, is_personal)
  values (left(resolved_name, 120), new.id, true)
  on conflict do nothing
  returning id into new_workspace_id;

  -- If the user already had a personal workspace, fall back to their existing
  -- one so the membership insert below is still idempotent.
  if new_workspace_id is null then
    select w.id into new_workspace_id
    from public.workspaces w
    where w.owner_id = new.id and w.is_personal
    limit 1;
  end if;

  -- 3. Owner membership.
  if new_workspace_id is not null then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (new_workspace_id, new.id, 'owner')
    on conflict (workspace_id, user_id) do nothing;
  end if;

  -- Settings row, so the app can read a theme without a fallback path.
  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'AFTER INSERT trigger on auth.users creating profile, personal workspace, owner membership and settings. Idempotent.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ===========================================================================
-- Last-owner protection
--
-- Prevents a workspace from being left with no owner, which would orphan it:
-- the RLS helper functions resolve owner privileges from workspace_members, so
-- an ownerless workspace becomes unmanageable.
--
-- DELETE is intentionally exempt - deleting the workspace itself is the correct
-- way to remove it, and cascading deletes the membership rows this trigger would
-- otherwise block.
-- ===========================================================================
create or replace function public.workspace_members_prevent_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining_owners integer;
begin
  if tg_op = 'DELETE' then
    if old.role <> 'owner' then
      return old;
    end if;

    select count(*) into remaining_owners
    from public.workspace_members wm
    where wm.workspace_id = old.workspace_id
      and wm.role = 'owner'
      and wm.id <> old.id;

    if remaining_owners = 0 then
      -- Allow the cascade when the workspace itself is being removed.
      if not exists (
        select 1 from public.workspaces w where w.id = old.workspace_id
      ) then
        return old;
      end if;

      raise exception
        'Cannot remove the last owner of workspace %. Promote another member to owner first, or delete the workspace.',
        old.workspace_id
        using errcode = '23514';
    end if;

    return old;
  end if;

  -- UPDATE: demoting the only owner would orphan the workspace.
  if old.role = 'owner' and new.role <> 'owner' then
    select count(*) into remaining_owners
    from public.workspace_members wm
    where wm.workspace_id = old.workspace_id
      and wm.role = 'owner'
      and wm.id <> old.id;

    if remaining_owners = 0 then
      raise exception
        'Cannot demote the last owner of workspace %. Promote another member first.',
        old.workspace_id
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists workspace_members_prevent_last_owner on public.workspace_members;
  create trigger workspace_members_prevent_last_owner
  before update or delete on public.workspace_members
  for each row execute function public.workspace_members_prevent_last_owner();


-- ===========================================================================
-- Repair helper for existing accounts
--
-- Idempotent backfill for any user that predates this trigger, so applying the
-- migrations to a database that already has users does not leave them without a
-- workspace.
--
-- `security definer` is necessary: it runs as the owner and therefore is not
-- subject to the RLS policies it is repairing.
-- ---------------------------------------------------------------------------
create or replace function public.backfill_missing_personal_workspaces()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer := 0;
  target_user record;
  created_workspace uuid;
begin
  for target_user in
    select u.id
    from auth.users u
    where not exists (
      select 1 from public.workspaces w
      where w.owner_id = u.id and w.is_personal
    )
  loop
    insert into public.profiles (id, display_name)
    values (
      target_user.id,
      coalesce(
        nullif(btrim(target_user.raw_user_meta_data ->> 'display_name'), ''),
        nullif(btrim(split_part(coalesce(target_user.email, ''), '@', 1)), ''),
        'My Workspace'
      )
    )
    on conflict (id) do nothing;

    insert into public.workspaces (name, owner_id, is_personal)
    values ('My Workspace', target_user.id, true)
    on conflict do nothing
    returning id into created_workspace;

    if created_workspace is null then
      select w.id into created_workspace
      from public.workspaces w
      where w.owner_id = target_user.id and w.is_personal
      limit 1;
    end if;

    if created_workspace is not null then
      insert into public.workspace_members (workspace_id, user_id, role)
      values (created_workspace, target_user.id, 'owner')
      on conflict (workspace_id, user_id) do nothing;
    end if;

    inserted_count := inserted_count + 1;
  end loop;

  return inserted_count;
end;
$$;

comment on function public.backfill_missing_personal_workspaces() is
  'Idempotently creates profile, personal workspace, owner membership and settings for any auth user that lacks them. Returns the number of users processed.';