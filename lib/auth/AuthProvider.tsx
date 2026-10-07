"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import type { User } from "@supabase/supabase-js";
import { getAuthState, onAuthStateChange, signOut as signOutRequest } from "@/lib/auth/client";
import { loadBootstrap } from "@/lib/data/account";
import { toDataError, type DataError } from "@/lib/data/errors";
import type { ProfileRow, UserSettingsRow, WorkspaceWithRole } from "@/lib/data/types";

/**
 * Authentication and workspace context.
 *
 * Holds the three things every screen needs and nothing more:
 *
 *   authStatus  unknown | authenticated | unauthenticated
 *   user        the authenticated user
 *   workspace   the personal workspace, resolved once after sign-in
 *
 * The profile/workspace rows are created by the database trigger, so this
 * component only reads them via `loadBootstrap`. It never creates them.
 *
 * `unknown` is a real third state, distinct from `unauthenticated`: it means the
 * session has not been checked yet. Rendering the app during that window would
 * flash a signed-out UI at a signed-in user, and rendering the login screen
 * would flash it at everyone.
 */

export type AuthStatus = "unknown" | "authenticated" | "unauthenticated";

export type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  workspace: WorkspaceWithRole | null;
  profile: ProfileRow | null;
  settings: UserSettingsRow | null;
  /** True while the post-sign-in bootstrap is still running. */
  bootstrapping: boolean;
  error: DataError | null;
  refresh: () => Promise<void>;
  /**
   * Signs out and clears client auth state.
   *
   * Resolves with a `DataError` when the server call failed, or null on success.
   * Local state is cleared either way - see the implementation for why.
   */
  signOut: () => Promise<DataError | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export type AuthProviderProps = {
  children: ReactNode;
  /** Optional server-resolved session, so the first paint is already correct. */
  initialUserId?: string | null;
  /**
   * Server-resolved bootstrap values.
   *
   * `getServerSideProps` has already fetched these, so passing them through
   * avoids a duplicate client round trip and the loading flash that comes with
   * it - previously the profile control briefly rendered as "No name set" on
   * every page load. When absent, the provider falls back to fetching.
   */
  initialProfile?: ProfileRow | null;
  initialWorkspace?: WorkspaceWithRole | null;
  initialSettings?: UserSettingsRow | null;
};

export function AuthProvider({
  children,
  initialUserId = null,
  initialProfile = null,
  initialWorkspace = null,
  initialSettings = null
}: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>(initialUserId ? "authenticated" : "unknown");
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceWithRole | null>(initialWorkspace);
  const [profile, setProfile] = useState<ProfileRow | null>(initialProfile);
  const [settings, setSettings] = useState<UserSettingsRow | null>(initialSettings);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [error, setError] = useState<DataError | null>(null);
  // Whether the bootstrap values came from the server, so we do not re-fetch
  // what we were already handed.
  const [bootstrapped, setBootstrapped] = useState(Boolean(initialUserId && initialWorkspace));

  // Guards against a state update after unmount, which is a real hazard here:
  // the bootstrap is asynchronous and sign-out can happen mid-flight.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const bootstrap = useCallback(async (userId: string) => {
    setBootstrapping(true);
    setError(null);
    try {
      const result = await loadBootstrap(userId);
      if (!mounted.current) return;
      setWorkspace(result.workspace);
      setProfile(result.profile);
      setSettings(result.settings);
    } catch (caught) {
      if (!mounted.current) return;
      // A bootstrap failure is surfaced, never swallowed: it would otherwise
      // look like an empty app and invite the user to recreate existing data.
      setError(toDataError(caught, "Could not load your workspace."));
    } finally {
      if (mounted.current) setBootstrapping(false);
    }
  }, []);

  const clearSession = useCallback(() => {
    setWorkspace(null);
    setProfile(null);
    setSettings(null);
    setError(null);
    setBootstrapping(false);
  }, []);

  // Resolve the initial session on mount.
  useEffect(() => {
    let cancelled = false;
    if (initialUserId && bootstrapped) {
      // Server already resolved everything; nothing to fetch.
    } else if (initialUserId) {
      void bootstrap(initialUserId);
    } else {
      void (async () => {
        const state = await getAuthState();
        if (cancelled || !mounted.current) return;

        // "unknown" must NOT be collapsed into "unauthenticated". It means the
        // session check could not complete (offline, blocked request), so the
        // startup gate stays in its loading state and waits for the
        // onAuthStateChange subscription below to resolve it. Deciding
        // "signed out" here would eject a valid user on a connectivity blip.
        setUser(state.user);
        setStatus(state.status);
        if (state.user) void bootstrap(state.user.id);
      })();
    }
    return () => {
      cancelled = true;
    };
    // Intentionally runs once: later changes are handled by onAuthStateChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (bootstrapped) setBootstrapping(false);
  }, [bootstrapped]);

  // React to sign-in, sign-out and silent token refresh.
  useEffect(() => {
    const unsubscribe = onAuthStateChange((state) => {
      if (!mounted.current) return;
      setUser(state.user);
      setStatus(state.status);

      if (state.user) {
        // Only re-bootstrap when the user actually changed; a TOKEN_REFRESHED
        // event carries the same id and must not re-query the workspace.
        setStatus((previous) => {
          if (previous !== "authenticated") void bootstrap(state.user!.id);
          return "authenticated";
        });
      } else {
        clearSession();
      }
    });
    return unsubscribe;
  }, [bootstrap, clearSession]);

  const refresh = useCallback(async () => {
    const state = await getAuthState();
    if (!mounted.current) return;
    setUser(state.user);
    setStatus(state.status);
    if (state.user) await bootstrap(state.user.id);
    else clearSession();
  }, [bootstrap, clearSession]);

  /**
   * Signs out and drops every piece of client auth state.
   *
   * The local state is cleared even when the network call FAILS. That is the
   * deliberate choice: Supabase has already discarded this device's tokens
   * locally by the time it answers, so a failed request cannot restore the
   * session, and leaving the UI populated would show the user their data while
   * the app is in fact signed out. Failing closed is the only honest outcome.
   *
   * The caller is responsible for navigating away with a full page load, so
   * that `getServerSideProps` re-evaluates the (now absent) session and the
   * protected app cannot be reached client-side.
   */
  const signOut = useCallback(async () => {
    let failure: DataError | null = null;
    try {
      const result = await signOutRequest();
      if (!result.ok) failure = result.error;
    } catch (caught) {
      failure = toDataError(caught, "Could not sign out.");
    }

    if (!mounted.current) return failure;
    clearSession();
    setUser(null);
    setStatus("unauthenticated");
    // Re-arming the bootstrap gate means a subsequent sign-in in this same
    // document re-reads the profile and workspace instead of trusting values
    // left over from the previous session.
    setBootstrapped(false);
    return failure;
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, workspace, profile, settings, bootstrapping, error, refresh, signOut }),
    [status, user, workspace, profile, settings, bootstrapping, error, refresh, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an <AuthProvider>.");
  }
  return context;
};

/**
 * The active workspace id, or null while signed out / still bootstrapping.
 *
 * Every data call needs this. Returning null rather than throwing keeps the
 * unauthenticated case an ordinary render path.
 */
export const useWorkspaceId = (): string | null => useAuth().workspace?.id ?? null;