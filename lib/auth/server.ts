import type { GetServerSidePropsContext } from "next";
import { createServerClientForRequest } from "@/lib/supabase/server";
import { toDataError } from "@/lib/data/errors";

/**
 * Server-side session helpers for the Pages Router.
 *
 * STRICT COMPATIBILITY: this project uses the Pages Router, so there is no
 * `cookies()` store from `next/headers`. The session is read from the
 * `req`/`res` pair that `getServerSideProps` receives, which is the Pages
 * Router equivalent. Nothing here imports App Router APIs.
 *
 * NOTE: these modules use an explicit runtime browser guard rather than the
 * `server-only` package, which cannot be used from the Pages Router.
 *
 * These helpers are the reason `pages/index.tsx` can protect itself: the
 * session is established on the server, before any HTML is sent, so an
 * unauthenticated visitor is redirected and never receives the app shell.
 */

export type ServerSession = {
  userId: string;
  email: string | null;
};

export const getServerSession = async (
  context: Pick<GetServerSidePropsContext, "req" | "res">
): Promise<ServerSession | null> => {
  try {
    const supabase = createServerClientForRequest(context.req, context.res);

    // `getUser()` revalidates the JWT with the auth server rather than trusting
    // the cookie contents, which is what makes this safe for authorisation.
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;

    return { userId: data.user.id, email: data.user.email ?? null };
  } catch {
    // A missing/misconfigured environment must not crash rendering; the page
    // simply behaves as signed out.
    return null;
  }
};

export const requireServerSession = async (
  context: Pick<GetServerSidePropsContext, "req" | "res">
): Promise<ServerSession> => {
  const session = await getServerSession(context);
  if (!session) {
    throw new Error(
      `requireServerSession called without a session. Use getServerSession and redirect instead. (${
        toDataError(new Error("no session")).message
      })`
    );
  }
  return session;
};

/**
 * Standard redirect result for `getServerSideProps`.
 */
export const buildRedirect = (destination: string) => ({
  redirect: { destination, permanent: false }
});