import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
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
  const ready = useAuthPageReady();
  useApplyTheme();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Arriving straight from a successful registration.
  const justRegistered = router.query.registered === "1";

  // Already signed in? Skip the form entirely.
  useEffect(() => {
    void (async () => {
      const state = await getAuthState();
      if (state.user) void router.replace("/");
    })();
  }, [router]);

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

  if (!ready) return null;

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