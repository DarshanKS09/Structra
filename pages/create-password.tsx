import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import {
  AuthError,
  AuthForm,
  AuthNotice,
  AuthShell,
  authButtonClass,
  authInputClass,
  useApplyTheme,
  useAuthPageReady
} from "@/components/auth/AuthShell";
import { completeRegistration } from "@/lib/auth/registration-client";

/** Mirrors the server's policy so the user is told before a round trip. */
const PASSWORD_RULES: { test: (value: string) => boolean; label: string }[] = [
  { test: (v) => v.length >= 8, label: "At least 8 characters" },
  { test: (v) => /[a-z]/.test(v), label: "A lowercase letter" },
  { test: (v) => /[A-Z]/.test(v), label: "An uppercase letter" },
  { test: (v) => /\d/.test(v), label: "A number" }
];

/**
 * Registration step 3 - choose a password.
 *
 * Reached only with a valid registration token, which the server issued after
 * the code was verified. On success the account exists but no session does:
 * the user is sent to the login page to authenticate, as specified.
 */
export default function CreatePasswordPage() {
  const router = useRouter();
  const ready = useAuthPageReady();
  useApplyTheme();

  const email = typeof router.query.email === "string" ? router.query.email : "";
  const token = typeof router.query.token === "string" ? router.query.token : "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // No token means the verification step was skipped or the link was lost.
  useEffect(() => {
    if (router.isReady && (!email || !token)) void router.replace("/signup");
  }, [router, email, token]);

  const unmet = PASSWORD_RULES.filter((rule) => !rule.test(password));

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (unmet.length > 0) {
      setError("Your password does not meet all the requirements.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await completeRegistration(token, password);

      if (!result.ok) {
        setError(result.error ?? "We could not create your account.");
        // An expired or spent token cannot be recovered; start again.
        if (result.code === "INVALID_TOKEN") {
          setTimeout(() => void router.replace("/signup"), 1800);
        }
        return;
      }

      // Deliberate: no automatic sign-in. Send the user to LOGIN.
      void router.replace(`/login?registered=1&email=${encodeURIComponent(result.email ?? email)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!ready || !email || !token) return null;

  return (
    <>
      <Head>
        <title>Choose a password · Structra</title>
      </Head>
      <AuthShell
        title="Choose a password"
        subtitle="Almost there. Pick a password to protect your account."
      >
        <AuthError message={error} />
        <AuthNotice message={null} />

        <AuthForm onSubmit={onSubmit}>
          <label className="mb-3 block">
            <span className="mb-1 block text-xs text-slate-300 light:text-slate-600">Password</span>
            <input
              type="password"
              required
              autoComplete="new-password"
              className={authInputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <ul className="mb-3 space-y-1">
            {PASSWORD_RULES.map((rule) => {
              const met = rule.test(password);
              return (
                <li
                  key={rule.label}
                  className={`text-[11px] ${met ? "text-emerald-300 light:text-emerald-700" : "text-slate-400 light:text-slate-500"}`}
                >
                  {met ? "✓" : "•"} {rule.label}
                </li>
              );
            })}
          </ul>

          <label className="mb-4 block">
            <span className="mb-1 block text-xs text-slate-300 light:text-slate-600">
              Confirm password
            </span>
            <input
              type="password"
              required
              autoComplete="new-password"
              className={authInputClass}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>

          <button
            type="submit"
            disabled={submitting || unmet.length > 0 || password !== confirm}
            className={authButtonClass}
          >
            {submitting ? "Creating account..." : "Create account"}
          </button>
        </AuthForm>
      </AuthShell>
    </>
  );
}