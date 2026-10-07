import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import {
  AuthError,
  AuthForm,
  AuthLink,
  AuthNotice,
  AuthShell,
  authButtonClass,
  authInputClass,
  useApplyTheme,
  useAuthPageReady
} from "@/components/auth/AuthShell";
import { getAuthState } from "@/lib/auth/client";
import { registrationHref, requestCode } from "@/lib/auth/registration-client";

/**
 * Registration step 1 - email address.
 *
 * Replaces the previous direct email+password signup. An account can no longer
 * be created from the browser in one step: the address must be proven with a
 * one-time code first, and the account is only created by the server after that
 * code is verified.
 *
 * The server's response is deliberately vague about whether the address already
 * has an account, so this screen shows the same confirmation either way.
 */
export default function SignupPage() {
  const router = useRouter();
  const ready = useAuthPageReady();
  useApplyTheme();

  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      const state = await getAuthState();
      if (state.user) void router.replace("/");
    })();
  }, [router]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);

    try {
      const result = await requestCode(email);

      if (!result.ok) {
        setError(result.error ?? "We could not send the code. Please try again.");
        if (result.retryAfterSeconds) setRetryAfter(result.retryAfterSeconds);
        return;
      }

      if (result.delivery === "console") {
        // Development transport: no mailbox involved, so say so rather than
        // sending the user hunting for an email that was never sent.
        setNotice("Email is not configured on this server, so the code was printed to the server console.");
      }

      void router.push(registrationHref(email.trim()));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!ready) return null;

  return (
    <>
      <Head>
        <title>Create account · Structra</title>
      </Head>
      <AuthShell
        title="Create your account"
        subtitle="Verify your email with a one-time code, then choose a password."
        footer={
          <>
            Already have an account? <AuthLink href="/login">Sign in</AuthLink>
          </>
        }
      >
        <AuthError message={error} />
        <AuthNotice message={notice} />

        <AuthForm onSubmit={onSubmit}>
          <label className="mb-4 block">
            <span className="mb-1 block text-xs text-slate-300 light:text-slate-600">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              className={authInputClass}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <button type="submit" disabled={submitting} className={authButtonClass}>
            {submitting ? "Sending code..." : "Send verification code"}
          </button>
        </AuthForm>

        {retryAfter ? (
          <p className="mt-3 text-center text-[11px] text-amber-300 light:text-amber-700">
            Try again in about {Math.ceil(retryAfter / 60)} minute(s).
          </p>
        ) : null}
      </AuthShell>
    </>
  );
}