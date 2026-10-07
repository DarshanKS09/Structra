import { useEffect, useRef, useState, type FormEvent } from "react";
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
  authSecondaryButtonClass,
  useApplyTheme,
  useAuthPageReady
} from "@/components/auth/AuthShell";
import { requestCode, verifyCode } from "@/lib/auth/registration-client";

const OTP_INPUT_LENGTH = 6;

/**
 * Registration step 2 - enter the verification code.
 *
 * Re-sending is available but is never automatic: a silent resend would race
 * with the user's typing and make the two codes ambiguous.
 */
export default function VerifyOtpPage() {
  const router = useRouter();
  const ready = useAuthPageReady();
  useApplyTheme();

  const email = typeof router.query.email === "string" ? router.query.email : "";
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (email) inputRef.current?.focus();
  }, [email]);

  // A refresh with no address in the query cannot continue the flow.
  useEffect(() => {
    if (router.isReady && !email) void router.replace("/signup");
  }, [router, email]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);

    try {
      const result = await verifyCode(email, code);

      if (!result.ok) {
        setError(result.error ?? "That code is not correct.");
        if (result.attemptsRemaining !== undefined) setAttemptsRemaining(result.attemptsRemaining);
        setCode("");
        inputRef.current?.focus();
        return;
      }

      if (!result.registrationToken) {
        setError("Verification did not complete. Please try again.");
        return;
      }

      void router.push(
        `/create-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(result.registrationToken)}`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  const onResend = async () => {
    setError(null);
    setNotice(null);
    setResending(true);
    try {
      const result = await requestCode(email);
      if (!result.ok) {
        setError(result.error ?? "Could not send a new code.");
        return;
      }
      setAttemptsRemaining(null);
      setNotice("A new code is on its way. The previous code no longer works.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setResending(false);
    }
  };

  if (!ready || !email) return null;

  return (
    <>
      <Head>
        <title>Verify your email · Structra</title>
      </Head>
      <AuthShell
        title="Enter your code"
        subtitle={`We sent a six-digit code to ${email}`}
        footer={<AuthLink href={`/signup?email=${encodeURIComponent(email)}`}>Use a different email</AuthLink>}
      >
        <AuthError message={error} />
        <AuthNotice message={notice} />

        <AuthForm onSubmit={onSubmit}>
          <label className="mb-4 block">
            <span className="mb-1 block text-xs text-slate-300 light:text-slate-600">
              Verification code
            </span>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={OTP_INPUT_LENGTH}
              pattern="\d{6}"
              required
              className={`${authInputClass} text-center text-2xl tracking-[0.5em]`}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, OTP_INPUT_LENGTH))}
            />
          </label>

          <button type="submit" disabled={submitting || code.length !== OTP_INPUT_LENGTH} className={authButtonClass}>
            {submitting ? "Verifying..." : "Verify code"}
          </button>
        </AuthForm>

        {attemptsRemaining !== null ? (
          <p className="mt-3 text-center text-[11px] text-amber-300 light:text-amber-700">
            {attemptsRemaining} attempt{attemptsRemaining === 1 ? "" : "s"} left before the code is
            invalidated.
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void onResend()}
          disabled={resending}
          className={`${authSecondaryButtonClass} mt-3 disabled:opacity-60`}
        >
          {resending ? "Sending..." : "Send a new code"}
        </button>

        <p className="mt-3 text-center text-[11px] text-slate-400 light:text-slate-500">
          Codes expire after 10 minutes and can only be used once.
        </p>
      </AuthShell>
    </>
  );
}