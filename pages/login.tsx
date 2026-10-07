import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import type { GetServerSideProps } from "next";
import {
  AuthError,
  AuthForm,
  AuthLink,
  AuthShell,
  authButtonClass,
  authInputClass,
  useApplyTheme,
  useAuthPageReady
} from "@/components/auth/AuthShell";
import { getAuthState, signIn } from "@/lib/auth/client";
import { AuthNotice } from "@/components/auth/AuthShell";

export default function LoginPage() {
  const router = useRouter();
  const { ready, signedIn } = useAuthPageReady();
  useApplyTheme();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Arriving straight from a successful registration.
  const justRegistered = router.query.registered === "1";

  // Already signed in? Skip the form entirely.
  //
  // `getServerSideProps` below normally handles this before any HTML is sent,
  // so this is the client-side fallback for a session that appeared (or was
  // restored) after the page had already loaded.
  useEffect(() => {
    if (!signedIn) return;
    void router.replace("/");
  }, [router, signedIn]);

  // Prefill the address the user just registered with. Routing this through the
  // query string (rather than local state) means it survives a refresh.
  useEffect(() => {
    const fromQuery = router.query.email;
    if (typeof fromQuery === "string" && fromQuery) setEmail(fromQuery);
  }, [router.query.email]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const result = await signIn(email, password);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    // Full navigation so the server re-runs getServerSideProps and establishes
    // the session for this request.
    void router.replace("/");
  };

  // Nothing is rendered until the session check has actually completed, so the
  // login form is never painted for a user who is already signed in. A failed
  // check still reveals the form, so a network problem cannot lock anyone out.
  if (!ready || signedIn) return null;

  return (
    <>
      <Head>
        <title>Sign in · Structra</title>
      </Head>
      <AuthShell
        title="Welcome back"
        subtitle="Sign in to reach your lists."
        footer={
          <>
            New here? <AuthLink href="/signup">Create an account</AuthLink>
          </>
        }
      >
        <AuthError message={error} />
        {justRegistered ? (
          <AuthNotice message="Your account is ready. Sign in to continue." />
        ) : null}

        <AuthForm onSubmit={onSubmit}>
          <label className="mb-3 block">
            <span className="mb-1 block text-xs text-slate-300 light:text-slate-600">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              className={authInputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="mb-4 block">
            <span className="mb-1 block text-xs text-slate-300 light:text-slate-600">Password</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              className={authInputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <button type="submit" disabled={submitting} className={authButtonClass}>
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </AuthForm>

        <div className="mt-3 text-center">
          <AuthLink href="/forgot-password">Forgot your password?</AuthLink>
        </div>
      </AuthShell>
    </>
  );
}

/**
 * Redirects a visitor who already has a valid session.
 *
 * Without this the login page can only discover the session from the browser,
 * which means the form is rendered and then taken away - a visible flash for
 * every returning user (requirement 4). Resolving it here means a signed-in
 * visitor is redirected before any HTML is sent, so the form is never painted
 * for them.
 *
 * `getUser()` revalidates the JWT with the auth server rather than trusting the
 * cookie, so a stale cookie cannot let someone in. The pages that redirect here
 * are public pages, so a failure simply falls through to rendering the form.
 */
export const getServerSideProps: GetServerSideProps = async (context) => {
  const { getServerSession, buildRedirect } = await import("@/lib/auth/server");

  const session = await getServerSession(context);
  if (session) {
    // `next` lets a deep link win, so a user following /login?next=/grocery
    // lands where they intended rather than always at the root.
    const next = typeof context.query.next === "string" && context.query.next.startsWith("/")
      ? context.query.next
      : "/";
    return buildRedirect(next);
  }

  return { props: {} };
};