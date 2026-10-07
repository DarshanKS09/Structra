import { useState, type FormEvent } from "react";
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
import { requestPasswordReset } from "@/lib/auth/client";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const ready = useAuthPageReady();
  useApplyTheme();

  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);

    const result = await requestPasswordReset(email);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setNotice("If that address has an account, a reset link is on its way.");
  };

  if (!ready) return null;

  return (
    <>
      <Head>
        <title>Reset password · Structra</title>
      </Head>
      <AuthShell
        title="Reset your password"
        subtitle="We'll email you a link to choose a new one."
        footer={<AuthLink href="/login">Back to sign in</AuthLink>}
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
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button type="submit" disabled={submitting} className={authButtonClass}>
            {submitting ? "Sending..." : "Send reset link"}
          </button>
        </AuthForm>

        <button
          type="button"
          onClick={() => void router.push("/login")}
          className="mt-4 w-full text-xs text-slate-400 underline-offset-4 hover:underline light:text-slate-500"
        >
          Cancel
        </button>
      </AuthShell>
    </>
  );
}