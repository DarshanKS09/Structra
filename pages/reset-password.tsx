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
import { getCurrentUser, updatePassword } from "@/lib/auth/client";

/**
 * Chooses a new password after following a recovery link.
 *
 * The link lands on `/auth/callback`, which exchanges the tokens for a session
 * and redirects here. If that exchange did not happen - expired link, opened in
 * a different browser - there is no session and this page says so instead of
 * silently failing.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const ready = useAuthPageReady();
  useApplyTheme();

  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      const user = await getCurrentUser();
      setHasSession(Boolean(user));
    })();
  }, []);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setSubmitting(true);
    const result = await updatePassword(password);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setNotice("Password updated. Redirecting...");
    void router.replace("/");
  };

  if (!ready) return null;

  return (
    <>
      <Head>
        <title>Choose a new password · Structra</title>
      </Head>
      <AuthShell title="Choose a new password" subtitle="Pick something you have not used before.">
        <AuthError message={error} />
        <AuthNotice message={notice} />

        {hasSession === null ? (
          <p className="text-sm text-slate-400 light:text-slate-500">Checking your link...</p>
        ) : hasSession === false ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-300 light:text-slate-600">
              This reset link is invalid or has expired. Request a new one to continue.
            </p>
            <button
              type="button"
              onClick={() => void router.push("/forgot-password")}
              className={authButtonClass}
            >
              Request a new link
            </button>
          </div>
        ) : (
          <AuthForm onSubmit={onSubmit}>
            <label className="mb-3 block">
              <span className="mb-1 block text-xs text-slate-300 light:text-slate-600">
                New password
              </span>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className={authInputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>

            <label className="mb-4 block">
              <span className="mb-1 block text-xs text-slate-300 light:text-slate-600">
                Confirm password
              </span>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className={authInputClass}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>

            <button type="submit" disabled={submitting} className={authButtonClass}>
              {submitting ? "Updating..." : "Update password"}
            </button>
          </AuthForm>
        )}
      </AuthShell>
    </>
  );
}