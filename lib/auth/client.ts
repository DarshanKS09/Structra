import type { User } from "@supabase/supabase-js";
import { db } from "@/lib/data/client";
import { toDataError, DataError, type DataErrorCode } from "@/lib/data/errors";

/**
 * Client-side authentication.
 *
 * Every function here runs in the browser and returns a discriminated result
 * rather than throwing, because auth failures are expected user states (wrong
 * password, unconfirmed email) and not exceptional conditions. Genuinely
 * unexpected errors are still surfaced as `DataError` so nothing is hidden.
 *
 * SECURITY: user identifiers are never accepted as parameters. The signed-in
 * user is always read from the Supabase session via `auth.getUser()`, and
 * workspace scoping happens server-side through RLS. Nothing here trusts an id
 * supplied by the caller.
 */

export type AuthFailure = {
  ok: false;
  error: DataError;
};

export type AuthSuccess<T> = { ok: true; value: T };

export type AuthResult<T = void> = AuthSuccess<T> | AuthFailure;

const fail = (error: unknown): AuthFailure => ({ ok: false, error: toDataError(error, "Authentication failed.") });

/** Auth-specific error codes worth distinguishing in the UI. */
export type AuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "EMAIL_NOT_CONFIRMED"
  | "EMAIL_ALREADY_REGISTERED"
  | "WEAK_PASSWORD"
  | "RATE_LIMITED"
  | "NETWORK"
  | "SESSION_EXPIRED"
  | "UNKNOWN";

export type AuthState = {
  status: "unknown" | "authenticated" | "unauthenticated";
  user: User | null;
};

const classifyAuthMessage = (message: string, lowerMessage: string): AuthErrorCode => {
  if (lowerMessage.includes("invalid login credentials")) return "INVALID_CREDENTIALS";
  if (lowerMessage.includes("email not confirmed")) return "EMAIL_NOT_CONFIRMED";
  if (lowerMessage.includes("already registered") || lowerMessage.includes("already been registered")) {
    return "EMAIL_ALREADY_REGISTERED";
  }
  if (lowerMessage.includes("password should be") || lowerMessage.includes("weak") || lowerMessage.includes("at least")) {
    return "WEAK_PASSWORD";
  }
  if (lowerMessage.includes("rate limit") || lowerMessage.includes("too many") || lowerMessage.includes("security purposes")) {
    return "RATE_LIMITED";
  }
  if (lowerMessage.includes("fetch") || lowerMessage.includes("network")) return "NETWORK";
  if (lowerMessage.includes("token") || lowerMessage.includes("session") || lowerMessage.includes("jwt")) return "SESSION_EXPIRED";
  void message;
  return "UNKNOWN";
};

const authError = (error: unknown, fallback: string): DataError => {
  const message = error instanceof Error ? error.message : String(error);
  const code = classifyAuthMessage(message, message.toLowerCase());
  return new DataError(code === "NETWORK" ? "NETWORK" : "UNAUTHENTICATED", fallback, {
    cause: error,
    retryable: code === "NETWORK" || code === "RATE_LIMITED"
  });
};

/** The codes above, surfaced so the UI can branch without string matching. */
export type AuthIssue = { kind: AuthErrorCode; message: string };

const issueFrom = (error: DataError, fallback: string): AuthIssue => {
  const cause = (error as { cause?: unknown }).cause;
  const message = cause instanceof Error ? cause.message : error.message;
  const kind = classifyAuthMessage(error.message, message.toLowerCase());
  return { kind, message: kind === "UNKNOWN" ? error.message || fallback : fallback };
};

export { issueFrom as authIssueFrom };

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * Reads the authenticated user.
 *
 * Uses `getUser()` rather than `getSession()` because only `getUser()`
 * revalidates the JWT with the auth server. `getSession()` reads a
 * client-readable cookie and must never be trusted for an authorisation
 * decision.
 *
 * An error here is treated as "no user" rather than as an exception: an expired
 * or absent session is an ordinary unauthenticated state, not a fault.
 */
export const getCurrentUser = async (): Promise<User | null> => {
  const { data, error } = await db().auth.getUser();
  if (error) {
    // An expired/absent session is a normal unauthenticated state, not an error.
    return null;
  }
  return data.user ?? null;
};

/**
 * Resolves the current auth state for the app's startup decision.
 *
 * ---------------------------------------------------------------------------
 * WHY A NETWORK FAILURE IS "unknown", NOT "unauthenticated"
 * ---------------------------------------------------------------------------
 * `getUser()` has to reach the auth server, so it can fail for reasons that
 * have nothing to do with the session: the device is offline, DNS fails, the
 * request is blocked. Collapsing those into "signed out" makes a connectivity
 * blip eject a perfectly valid user to the login screen.
 *
 * So the three states are kept distinct:
 *
 *   authenticated    the server confirmed a session
 *   unauthenticated  the server confirmed there is no session (real answer)
 *   unknown          the question could not be answered
 *
 * Only an explicit confirmation of "no session" may send someone to the login
 * page. `unknown` keeps the startup gate in its loading state, which is exactly
 * requirement 4's "do not treat 'still loading' as 'unauthenticated'".
 */
export const getAuthState = async (): Promise<AuthState> => {
  try {
    const { data, error } = await db().auth.getUser();

    if (error) {
      // Distinguish "there is no session" from "we could not ask".
      //   403 / 400 Invalid Refresh Token -> genuinely signed out
      //   401                            -> genuinely signed out
      //   anything else (fetch/network)  -> unknown
      const status = (error as { status?: number }).status;
      const isAuthRejection = status === 401 || status === 403 || status === 400;
      if (isAuthRejection) {
        return { status: "unauthenticated", user: null };
      }
      return { status: "unknown", user: null };
    }

    return data.user
      ? { status: "authenticated", user: data.user }
      : { status: "unauthenticated", user: null };
  } catch {
    // A thrown error means the check did not complete.
    return { status: "unknown", user: null };
  }
};

/**
 * Subscribes to auth changes. Returns the unsubscribe function.
 *
 * Listens to `TOKEN_REFRESHED` as well as `SIGNED_IN`/`SIGNED_OUT` so the UI
 * learns when a silent refresh rotates the session, rather than continuing with
 * a stale access token until a request fails.
 */
export const onAuthStateChange = (
  handler: (state: AuthState) => void
): (() => void) => {
  const { data } = db().auth.onAuthStateChange((event, session) => {
    handler({
      status: session?.user ? "authenticated" : "unauthenticated",
      user: session?.user ?? null
    });
    void event;
  });
  return () => data.subscription.unsubscribe();
};

// ---------------------------------------------------------------------------
// Sign up / sign in / sign out
// ---------------------------------------------------------------------------

export type SignUpInput = {
  email: string;
  password: string;
  displayName?: string;
};

/**
 * Creates an account.
 *
 * The display name is passed as `raw_user_meta_data`, which the database
 * trigger reads when provisioning the profile, workspace and membership. The
 * frontend does not create any of those rows itself.
 */
export const signUp = async (input: SignUpInput): Promise<AuthResult<{ requiresEmailConfirmation: boolean }>> => {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password) {
    return fail(new DataError("VALIDATION", "Email and password are required."));
  }

  const { data, error } = await db().auth.signUp({
    email,
    password: input.password,
    options: {
      data: input.displayName?.trim() ? { display_name: input.displayName.trim() } : {},
      // Return the session immediately when the project has email confirmation
      // disabled, so the app can continue straight to bootstrap. When
      // confirmation is required this is ignored and the user must confirm.
      emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined
    }
  });

  if (error) {
    return { ok: false, error: authError(error, "Could not create the account.") };
  }

  return {
    ok: true,
    value: { requiresEmailConfirmation: data.user?.email_confirmed_at === null }
  };
};

export const signIn = async (email: string, password: string): Promise<AuthResult<User>> => {
  const { data, error } = await db().auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password
  });

  if (error) {
    const normalised = authError(error, "Incorrect email or password.");
    const issue = issueFrom(normalised, "Incorrect email or password.");
    return {
      ok: false,
      error:
        issue.kind === "EMAIL_NOT_CONFIRMED"
          ? new DataError("UNAUTHENTICATED", "Confirm your email address before signing in.", { cause: error })
          : new DataError("UNAUTHENTICATED", normalised.message, { cause: error })
    };
  }

  if (!data.user) {
    return fail(new DataError("UNAUTHENTICATED", "Sign in did not return a user."));
  }
  return { ok: true, value: data.user };
};

/**
 * Signs the current session out.
 *
 * WHY THE SCOPE IS EXPLICIT
 *
 * `signOut()` with no argument defaults to `scope: "global"`, which revokes the
 * refresh token for EVERY device signed in to this account, not just this one.
 * A user who signs out on their laptop would silently be signed out on their
 * phone too, which is not what "Log out" implies here.
 *
 * `"local"` signs out only the session making the request: this device's tokens
 * are discarded and the cookie is cleared, while other devices keep working. That
 * matches the button's meaning and still fully satisfies requirement 3 for the
 * session in use.
 *
 * Note this does not stop an already-issued access token from working until it
 * expires (JWTs cannot be revoked individually). That window is inherent to
 * stateless tokens, not a consequence of this scope.
 */
export const signOut = async (): Promise<AuthResult> => {
  const { error } = await db().auth.signOut({ scope: "local" });
  if (error) return fail(toDataError(error, "Could not sign out."));
  return { ok: true, value: undefined };
};

// ---------------------------------------------------------------------------
// Email verification / password reset
// ---------------------------------------------------------------------------

/**
 * Resends a confirmation email.
 */
export const resendConfirmation = async (email: string): Promise<AuthResult> => {
  const { error } = await db().auth.resend({
    type: "signup",
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined }
  });
  if (error) return fail(toDataError(error, "Could not resend the confirmation email."));
  return { ok: true, value: undefined };
};

/** Sends a password-reset email containing a recovery link. */
export const requestPasswordReset = async (email: string): Promise<AuthResult> => {
  const { error } = await db().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: typeof window !== "undefined" ? `${window.location.origin}/auth/callback?next=/reset-password` : undefined
  });
  if (error) return fail(toDataError(error, "Could not send the reset email."));
  return { ok: true, value: undefined };
};

/**
 * Completes a password reset.
 *
 * The recovery link puts tokens in the URL hash; the callback route establishes
 * the session, after which this call changes the password. If there is no
 * session the reset silently fails, which is surfaced as an explicit error
 * rather than a false success.
 */
export const updatePassword = async (newPassword: string): Promise<AuthResult> => {
  if (!newPassword) return fail(new DataError("VALIDATION", "A new password is required."));

  const { data, error } = await db().auth.getUser();
  if (error || !data.user) {
    return fail(new DataError("UNAUTHENTICATED", "This reset link is invalid or has expired. Request a new one."));
  }

  const { error: updateError } = await db().auth.updateUser({ password: newPassword });
  if (updateError) return fail(toDataError(updateError, "Could not update the password."));
  return { ok: true, value: undefined };
};

/** Changes the password of the current session (account settings). */
export const changePassword = async (currentPassword: string, newPassword: string): Promise<AuthResult> => {
  const { data, error } = await db().auth.getUser();
  if (error || !data.user) return fail(new DataError("UNAUTHENTICATED", "You must be signed in."));

  const { error: reauthError } = await db().auth.signInWithPassword({
    email: data.user.email ?? "",
    password: currentPassword
  });
  if (reauthError) {
    return fail(new DataError("UNAUTHENTICATED", "Your current password is incorrect."));
  }

  const { error: updateError } = await db().auth.updateUser({ password: newPassword });
  if (updateError) return fail(toDataError(updateError, "Could not update the password."));
  return { ok: true, value: undefined };
};

/**
 * Exchanges a recovery/confirmation token pair for a session.
 *
 * Used by `/auth/callback`. Supabase sends the tokens either in the URL hash
 * (implicit/PKCE browser flow) or as `?code=`; both are handled.
 */
export const exchangeTokensForSession = async (
  hashOrCode: string | null
): Promise<AuthResult> => {
  if (!hashOrCode) return fail(new DataError("UNAUTHENTICATED", "No token supplied."));

  // `code=` style (PKCE / server-side exchange)
  if (!hashOrCode.startsWith("#") && /^[A-Za-z0-9._-]{20,}$/.test(hashOrCode) && !hashOrCode.includes("=")) {
    const { error } = await db().auth.exchangeCodeForSession(hashOrCode);
    if (error) return fail(toDataError(error, "This link is invalid or has expired."));
    return { ok: true, value: undefined };
  }

  // `#access_token=...&refresh_token=...`
  const params = new URLSearchParams(hashOrCode.replace(/^#/, ""));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) {
    return fail(new DataError("UNAUTHENTICATED", "This link is invalid or has expired."));
  }

  const { error } = await db().auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (error) return fail(toDataError(error, "This link is invalid or has expired."));
  return { ok: true, value: undefined };
};

export type { DataErrorCode };