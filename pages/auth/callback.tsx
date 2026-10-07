import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { AuthError, AuthShell, useApplyTheme } from "@/components/auth/AuthShell";
import { exchangeTokensForSession, resendConfirmation } from "@/lib/auth/client";

/**
 * Landing point for email confirmation and password-recovery links.
 *
 * Supabase sends the tokens either in the URL fragment
 * (`#access_token=...&refresh_token=...`) or as a `?code=` query parameter,
 * depending on the flow. Both are handled here and then removed from the
 * address bar with a history replace, so a refresh does not replay the exchange.
 *
 * After a successful exchange the user is sent to `next`, or to `/reset-password`
 * for a recovery flow. A failed exchange explains what to do rather than leaving
 * the user on a dead page.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  useApplyTheme();

  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"working" | "done">("working");
  const [email, setEmail] = useState("");

  useEffect(() => {
    const run = async () => {
      // `asPath` is needed because the fragment is not sent to the server.
      const fragment = typeof window !== "undefined" ? window.location.hash : "";
      const code = typeof router.query.code === "string" ? router.query.code : null;
      const token = code ?? (fragment || null);

      // A link with no token at all: confirmation and recovery both supply one.
      if (!token) {
        setError("This link is missing its token. Request a new one to continue.");
        setStatus("done");
        return;
      }

      const result = await exchangeTokensForSession(token);
      if (!result.ok) {
        setError(result.error.message);
        setStatus("done");
        return;
      }

      // Strip the tokens from the URL before navigating.
      window.history.replaceState({}, "", window.location.pathname);

      const next = typeof router.query.next === "string" ? router.query.next : "/";
      void router.replace(next);
    };

    void run();
  }, [router]);

  return (
    <>
      <Head>
        <title>Signing you in · Structra</title>
      </Head>
      <AuthShell title="Confirming your email" subtitle="One moment while we finish signing you in.">
        <AuthError message={error} />

        {status === "working" ? (
          <p className="text-sm text-slate-400 light:text-slate-500">Working...</p>
        ) : (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs text-slate-300 light:text-slate-600">
                Your email address
              </span>
              <input
                type="email"
                className="w-full rounded-2xl border border-white/20 bg-white/10 px-3 py-3 text-sm outline-none light:border-slate-300 light:bg-white"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="themed-accent-solid flex h-12 w-full items-center justify-center rounded-2xl text-sm font-semibold"
              onClick={async () => {
                const result = await resendConfirmation(email);
                if (result.ok) void router.push("/login");
              }}
            >
              Resend confirmation email
            </button>
            <button
              type="button"
              onClick={() => void router.push("/login")}
              className="h-12 w-full rounded-2xl border border-white/20 text-sm font-medium light:border-slate-300"
            >
              Go to sign in
            </button>
          </div>
        )}
      </AuthShell>
    </>
  );
}