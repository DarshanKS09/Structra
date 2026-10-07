import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Head from "next/head";
import Link from "next/link";
import { getAuthState } from "@/lib/auth/client";

/**
 * Shared chrome for the authentication screens.
 *
 * These pages are new, so they have no pre-existing design to preserve. They
 * reuse the existing visual language - dark glassmorphic surfaces, the Plus
 * Jakarta Sans font, the `themed-accent-*` accent classes - so signing in does
 * not feel like leaving the product.
 */

export type AuthShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <>
      <Head>
        <title>{`${title} · Structra`}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
        <div className="rounded-3xl border border-white/15 bg-surface p-6 shadow-glass backdrop-blur-xl light:border-slate-300 light:bg-white/80">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-slate-300 light:text-slate-600">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
        {footer ? <div className="mt-4 text-center text-sm">{footer}</div> : null}
      </main>
    </>
  );
}

export const authInputClass =
  "themed-accent-ring w-full rounded-2xl border border-white/20 bg-white/10 px-3 py-3 text-sm text-slate-100 outline-none backdrop-blur-sm placeholder:text-slate-300/75 light:border-slate-300 light:bg-white light:text-slate-800";

export const authButtonClass =
  "themed-accent-solid flex h-12 w-full items-center justify-center rounded-2xl text-sm font-semibold disabled:opacity-60";

export const authSecondaryButtonClass =
  "h-12 w-full rounded-2xl border border-white/20 text-sm font-medium light:border-slate-300";

export { authSecondaryButtonClass as secondaryButtonClass };

/** Error banner. Errors are always rendered - never swallowed into a neutral state. */
export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="mb-4 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200 light:text-rose-700"
    >
      {message}
    </div>
  );
}

export function AuthNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="status"
      className="mb-4 rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 light:text-emerald-700"
    >
      {message}
    </div>
  );
}

/**
 * Applies the persisted theme to `<html>`.
 *
 * Auth pages run before the main app mounts, so they must set the theme class
 * themselves or they flash the default ocean palette.
 */
export function useApplyTheme() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.documentElement.classList.remove("theme-ocean", "theme-crimson", "theme-light");

    let theme: string | null = null;
    try {
      const raw = window.localStorage.getItem("structra-ui-state-v2");
      if (raw) {
        const parsed = JSON.parse(raw) as { state?: { theme?: string } };
        theme = parsed?.state?.theme ?? null;
      }
    } catch {
      theme = null;
    }
    document.documentElement.classList.add(`theme-${theme ?? "ocean"}`);
  }, []);
}

export type AuthFormProps = {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
};

export function AuthForm({ onSubmit, children }: AuthFormProps) {
  return <form onSubmit={onSubmit}>{children}</form>;
}

export function AuthLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-slate-300 underline-offset-4 hover:underline light:text-slate-600">
      {children}
    </Link>
  );
}

/**
 * Gate for the unauthenticated pages.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT JUST A `mounted` FLAG
 * ---------------------------------------------------------------------------
 * The previous implementation was `useEffect(() => setReady(true), [])`, which
 * only reports that the component hydrated. It says nothing about whether a
 * session exists, so the login form was rendered on that basis alone - meaning
 * a returning user with a valid session was shown the form and *then* bounced,
 * which is exactly the flash requirement 4 rules out.
 *
 * This hook reports three distinct states instead of a single boolean:
 *
 *   ready=false       the session lookup is in flight - render nothing
 *   ready=true        no session, so this form is the correct screen
 *   signedIn=true     a session exists - redirect, and keep rendering nothing
 *
 * `getServerSideProps` on the login page answers the same question before any
 * HTML is sent, so a signed-in visitor never receives the form at all. The
 * browser check remains as a second line of defence, because a session can
 * appear or expire while the page is open; treating `signedIn` as "not ready"
 * closes the flash window in that case too.
 */
/** How many times to retry when the session check could not complete. */
const AUTH_CHECK_ATTEMPTS = 2;
/** Base delay between retries; grows linearly with the attempt number. */
const AUTH_CHECK_RETRY_MS = 250;

export function useAuthPageReady(): { ready: boolean; signedIn: boolean } {
  const [state, setState] = useState<{ ready: boolean; signedIn: boolean }>({
    ready: false,
    signedIn: false
  });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    void (async () => {
      // "unknown" means the check could not complete - offline, blocked
      // request. That is NOT a confirmed sign-out, so it must not immediately
      // reveal the form. It is retried a few times, which covers the ordinary
      // case of a device waking up or a tunnel reconnecting.
      for (let attempt = 0; attempt <= AUTH_CHECK_ATTEMPTS; attempt += 1) {
        if (cancelled) return;

        const authState = await getAuthState();
        if (cancelled) return;

        if (authState.status !== "unknown") {
          setState({
            ready: true,
            signedIn: authState.status === "authenticated"
          });
          return;
        }

        if (attempt === AUTH_CHECK_ATTEMPTS) break;
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, AUTH_CHECK_RETRY_MS * (attempt + 1));
        });
      }

      if (cancelled) return;

      // Still undetermined after every retry: the user is genuinely offline.
      // Showing the form is the lesser failure - they can still attempt to sign
      // in, and that attempt will surface a real network error, whereas a
      // permanently blank page looks like a broken app.
      setState({ ready: true, signedIn: false });
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return state;
}