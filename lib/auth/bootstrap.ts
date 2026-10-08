import type { GetServerSideProps } from "next";
import type { ProfileRow, UserSettingsRow, WorkspaceWithRole } from "@/lib/data/types";

/**
 * Shared server-side bootstrap for authenticated pages.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * `pages/index.tsx` already established the pattern: resolve the session on the
 * server, hand the profile/workspace/settings down as props, and redirect when
 * there is no session. Three more protected pages need exactly the same thing.
 *
 * Copying that `getServerSideProps` into each would mean four places to keep in
 * step with any future change to bootstrap behaviour - and the kind of drift that
 * produces "the analytics page shows a signed-out user the app shell". So the
 * logic lives here once and each page is a one-line call.
 *
 * ---------------------------------------------------------------------------
 * WHY IT REUSES THE REQUEST-SCOPED CLIENT
 * ---------------------------------------------------------------------------
 * `createServerClientForRequest` is bound to this request's `req`/`res`, so it
 * reads THIS visitor's session cookie and can refresh a rotated token back into
 * THIS response. No session is cached across requests, and nothing is held in
 * module scope where one visitor could see another's session.
 */

export type AuthBootstrapProps = {
  initialUserId: string;
  initialProfile: ProfileRow | null;
  initialWorkspace: WorkspaceWithRole | null;
  initialSettings: UserSettingsRow | null;
};

/**
 * Resolves the bootstrap props for a protected page.
 *
 * Returns a `redirect` when there is no valid session, so an unauthenticated
 * visitor is redirected before any page HTML is produced.
 *
 * A failure to read the profile/workspace is deliberately NOT fatal: the page
 * still renders with `null` values and the client re-reads, rather than showing
 * an error page for a user who is in fact signed in correctly.
 */
export const resolveAuthBootstrap = async (
  context: Parameters<GetServerSideProps>[0]
): Promise<
  | { props: AuthBootstrapProps }
  | { redirect: { destination: string; permanent: boolean } }
> => {
  const { getServerSession, buildRedirect } = await import("@/lib/auth/server");
  const { createServerClientForRequest } = await import("@/lib/supabase/server");

  const session = await getServerSession(context);
  // A redirect, not a 307 literal: `buildRedirect` keeps every page agreeing on
  // the same temporary-redirect shape.
  if (!session) return buildRedirect("/login");

  const empty: AuthBootstrapProps = {
    initialUserId: session.userId,
    initialProfile: null,
    initialWorkspace: null,
    initialSettings: null
  };

  try {
    const supabase = createServerClientForRequest(context.req, context.res);

    // Parallel: one round trip instead of three sequential ones.
    const [profileResult, membershipResult, settingsResult] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", session.userId).maybeSingle(),
      supabase
        .from("workspace_members")
        .select("workspace_id, role")
        .eq("user_id", session.userId)
        .eq("role", "owner")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase.from("user_settings").select("*").eq("user_id", session.userId).maybeSingle()
    ]);

    let workspace: WorkspaceWithRole | null = null;
    if (membershipResult.data) {
      const { data } = await supabase
        .from("workspaces")
        .select("*")
        .eq("id", membershipResult.data.workspace_id)
        .maybeSingle();
      if (data) workspace = { ...data, role: membershipResult.data.role };
    }

    return {
      props: {
        initialUserId: session.userId,
        initialProfile: profileResult.data ?? null,
        initialWorkspace: workspace,
        initialSettings: settingsResult.data ?? null
      }
    };
  } catch {
    return { props: empty };
  }
};

/**
 * `getServerSideProps` for a protected page.
 *
 * `next` is honoured so a signed-in visitor who follows a deep link such as
 * `/login?next=/analytics/study` lands where they intended.
 */
export const protectedPageProps: GetServerSideProps<AuthBootstrapProps> = async (context) => {
  void context;
  return resolveAuthBootstrap(context);
};