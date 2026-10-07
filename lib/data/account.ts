import { db } from "@/lib/data/client";
import { unwrap, toDataError, DataError } from "@/lib/data/errors";
import type {
  AppTheme,
  ProfileRow,
  ProfileUpdate,
  UserSettingsRow,
  UserSettingsUpdate,
  WorkspaceRole,
  WorkspaceRow,
  WorkspaceWithRole
} from "@/lib/data/types";

/**
 * Account, profile, settings and workspace access.
 *
 * IMPORTANT: no function here creates a profile or a workspace.
 *
 * The database already provisions a profile, a personal workspace, an owner
 * membership row and a settings row from an AFTER INSERT trigger on
 * `auth.users`. Re-implementing that in the client would create a second
 * source of truth and race with the trigger. These functions only *read* what
 * the trigger produced.
 */

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export const getProfile = async (userId: string): Promise<ProfileRow | null> => {
  const { data, error } = await db()
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw toDataError(error, "Could not load your profile.");
  return data;
};

/**
 * Updates presentation fields on the user's own profile row.
 *
 * The guard rejects an empty patch, but must NOT reject a patch whose values are
 * all null: clearing `avatar_url` is how a user goes from a photo or built-in
 * avatar back to their initial, so `{ avatar_url: null }` is a meaningful
 * update. Only a patch with no keys at all is a caller mistake.
 */
export const updateProfile = async (userId: string, patch: ProfileUpdate): Promise<ProfileRow> => {
  if (Object.keys(patch).length === 0) {
    throw new DataError("VALIDATION", "There is nothing to update.");
  }
  const { data, error } = await db()
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select("*")
    .single();
  if (error) throw toDataError(error, "Could not update your profile.");
  return data;
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const getUserSettings = async (userId: string): Promise<UserSettingsRow | null> => {
  const { data, error } = await db()
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw toDataError(error, "Could not load your settings.");
  return data;
};

/**
 * Updates settings, creating the row if the trigger somehow has not yet.
 *
 * `upsert` is used rather than `update` so a first write on a fresh account
 * succeeds instead of silently affecting zero rows.
 */
export const saveUserSettings = async (
  userId: string,
  patch: Omit<UserSettingsUpdate, "user_id">
): Promise<UserSettingsRow> => {
  const { data, error } = await db()
    .from("user_settings")
    .upsert({ user_id: userId, ...patch }, { onConflict: "user_id" })
    .select("*")
    .single();
  if (error) throw toDataError(error, "Could not save your settings.");
  return data;
};

export const setTheme = async (userId: string, theme: AppTheme): Promise<UserSettingsRow> =>
  saveUserSettings(userId, { theme });

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

/** Every workspace the user belongs to, with their role in each. */
export const listWorkspaces = async (userId: string): Promise<WorkspaceWithRole[]> => {
  // `role` must be selected explicitly; the embedded relation supplies only the
  // workspace columns.
  const { data, error } = await db()
    .from("workspace_members")
    .select("role, workspace:workspaces(*)")
    .eq("user_id", userId);
  if (error) throw toDataError(error, "Could not load your workspaces.");

  return (data ?? [])
    .map((row) => {
      const workspace = row.workspace as unknown;
      if (!workspace || typeof workspace !== "object") return null;
      return { ...(workspace as WorkspaceRow), role: row.role as WorkspaceRole };
    })
    .filter((w): w is WorkspaceWithRole => w !== null);
};

/**
 * The user's own personal workspace.
 *
 * RLS already restricts this to workspaces the caller is a member of, and the
 * unique partial index guarantees at most one per user, so `maybeSingle` cannot
 * legitimately return multiple rows.
 */
export const getPersonalWorkspace = async (userId: string): Promise<WorkspaceWithRole | null> => {
  const { data: membership, error } = await db()
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", userId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw toDataError(error, "Could not load your workspace.");

  if (!membership) return null;

  const { data: workspace, error: wsError } = await db()
    .from("workspaces")
    .select("*")
    .eq("id", membership.workspace_id)
    .maybeSingle();
  if (wsError) throw toDataError(wsError, "Could not load your workspace.");
  if (!workspace) return null;

  return { ...workspace, role: membership.role as WorkspaceRole };
};

export const getWorkspace = async (workspaceId: string): Promise<WorkspaceWithRole | null> => {
  const { data: workspace, error } = await db()
    .from("workspaces")
    .select("*")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw toDataError(error, "Could not load that workspace.");
  if (!workspace) return null;

  const { data: membership } = await db()
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", (await currentUserId()) ?? "")
    .maybeSingle();

  return { ...workspace, role: (membership?.role ?? "member") as WorkspaceRole };
};

const currentUserId = async (): Promise<string | null> => {
  const { data, error } = await db().auth.getUser();
  if (error) return null;
  return data.user?.id ?? null;
};

export type WorkspaceMemberSummary = {
  user_id: string;
  role: WorkspaceRole;
  created_at: string;
  profile: { display_name: string | null; avatar_url: string | null } | null;
};

export const listWorkspaceMembers = async (workspaceId: string): Promise<WorkspaceMemberSummary[]> => {
  const { data, error } = await db()
    .from("workspace_members")
    .select("user_id, role, created_at, profile:profiles(display_name, avatar_url)")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (error) throw toDataError(error, "Could not load workspace members.");

  return (data ?? []).map((row) => ({
    user_id: row.user_id,
    role: row.role as WorkspaceRole,
    created_at: row.created_at,
    profile: row.profile as unknown as WorkspaceMemberSummary["profile"]
  }));
};

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

export type BootstrapResult = {
  userId: string;
  email: string | null;
  profile: ProfileRow | null;
  workspace: WorkspaceWithRole;
  settings: UserSettingsRow | null;
};

/**
 * Resolves everything the app needs immediately after sign-in.
 *
 * The profile/workspace rows are created by the database trigger, so this only
 * reads them. A short retry covers the brief window where the signup response
 * returns before the trigger's transaction is visible to the caller's session.
 */
export const loadBootstrap = async (
  userId: string,
  options: { attempts?: number } = {}
): Promise<BootstrapResult> => {
  const attempts = options.attempts ?? 5;

  let workspace: WorkspaceWithRole | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    workspace = await getPersonalWorkspace(userId);
    if (workspace) break;
    await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
  }

  if (!workspace) {
    throw new DataError(
      "DATABASE",
      "Your workspace is still being set up. Please refresh in a moment."
    );
  }

  const [profile, settings] = await Promise.all([
    getProfile(userId).catch(() => null),
    getUserSettings(userId).catch(() => null)
  ]);

  const { data: userData } = await db().auth.getUser();

  return {
    userId,
    email: userData.user?.email ?? null,
    profile,
    workspace,
    settings
  };
};

export { unwrap };