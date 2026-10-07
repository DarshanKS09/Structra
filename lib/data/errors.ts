/**
 * Consistent error handling for the data-access layer.
 *
 * Every database call in `lib/data` funnels its failure through
 * `toDataError`. That gives three guarantees the UI depends on:
 *
 *  1. A caller can branch on a stable `code` rather than matching message text.
 *  2. The original database error is never swallowed - `cause` and `details`
 *     are preserved so a failure can be diagnosed instead of being hidden
 *     behind a generic "something went wrong".
 *  3. A permission failure is reported as a permission failure, not as an
 *     empty result set. Silently returning `[]` on an RLS rejection is the most
 *     dangerous possible bug in an app like this, because it looks like
 *     "no data yet" and invites the user to recreate data that already exists.
 */

/** Stable, exhaustive set of failure categories the UI can branch on. */
export type DataErrorCode =
  /** No Supabase session; the user must sign in again. */
  | "UNAUTHENTICATED"
  /** Session present but the JWT is expired/invalid and could not be refreshed. */
  | "SESSION_EXPIRED"
  /** Rejected by Row Level Security, or the row is not in the user's workspace. */
  | "FORBIDDEN"
  /** Referenced row does not exist (PostgREST PGRST116). */
  | "NOT_FOUND"
  /** A UNIQUE / CHECK / FK constraint rejected the write (Postgres 23xxx). */
  | "CONSTRAINT_VIOLATION"
  /** Row-level security violation raised by the database (42501). */
  | "PERMISSION_DENIED"
  /** The request never reached the database. */
  | "NETWORK"
  /** Request exceeded the client timeout. */
  | "TIMEOUT"
  /** Anything else, including unexpected database errors. */
  | "DATABASE"
  /** Client-side input failed validation before hitting the database. */
  | "VALIDATION";

export class DataError extends Error {
  readonly code: DataErrorCode;
  /** Raw database error code, e.g. "42501" or "PGRST116". */
  readonly dbCode: string | null;
  /** Database-supplied detail, preserved for diagnosis. */
  readonly details: string | null;
  /** Whether retrying the identical request could plausibly succeed. */
  readonly retryable: boolean;

  constructor(
    code: DataErrorCode,
    message: string,
    options: { dbCode?: string | null; details?: string | null; retryable?: boolean; cause?: unknown } = {}
  ) {
    super(message);
    this.name = "DataError";
    this.code = code;
    this.dbCode = options.dbCode ?? null;
    this.details = options.details ?? null;
    this.retryable = options.retryable ?? false;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export const isDataError = (value: unknown): value is DataError => value instanceof DataError;

/** Shape of the `{ error }` object PostgREST returns. */
type PostgrestErrorLike = {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
};

const POSTGREST_MESSAGES: Record<string, string> = {
  PGRST116: "The requested record was not found.",
  PGRST301: "This operation is not permitted for the current user."
};

const CONSTRAINT_MESSAGES: Record<string, string> = {
  "23505": "That value is already taken.",
  "23503": "That operation references a record that does not exist.",
  "23514": "That value is not allowed.",
  "23502": "A required value was missing.",
  "22001": "That value is too long.",
  "22P02": "That value has an invalid format."
};

/**
 * Maps any thrown value into a `DataError`.
 *
 * Handles the three shapes that actually reach this function:
 *   - `{ error, data }` pairs returned by supabase-js (not thrown)
 *   - `AuthApiError` / `PostgrestError` instances
 *   - genuine `Error`s from the network stack
 */
export const toDataError = (error: unknown, fallbackMessage = "Database request failed."): DataError => {
  if (isDataError(error)) return error;

  const candidate = (typeof error === "object" && error !== null ? error : {}) as PostgrestErrorLike & {
    status?: number;
    name?: string;
    __isAuthError?: boolean;
    message?: string;
  };
  const code = candidate.code ?? null;
  const message = candidate.message ?? (error instanceof Error ? error.message : fallbackMessage);
  const details = candidate.details ?? candidate.hint ?? null;

  // Auth failures, tagged by supabase-js.
  if (candidate.__isAuthError) {
    const lower = message.toLowerCase();
    if (lower.includes("invalid login") || lower.includes("credential")) {
      return new DataError("UNAUTHENTICATED", "Incorrect email or password.", { cause: error, dbCode: code });
    }
    if (lower.includes("token") || lower.includes("session") || lower.includes("jwt") || lower.includes("expired")) {
      return new DataError("SESSION_EXPIRED", "Your session has expired. Please sign in again.", { cause: error, dbCode: code });
    }
    if (lower.includes("already registered") || lower.includes("already been registered")) {
      return new DataError("CONSTRAINT_VIOLATION", "An account with that email already exists.", { cause: error, dbCode: code });
    }
    if (lower.includes("email rate limit") || lower.includes("rate limit")) {
      return new DataError("NETWORK", "Too many attempts. Please wait a moment and try again.", { cause: error, dbCode: code, retryable: true });
    }
    return new DataError("UNAUTHENTICATED", message, { cause: error, dbCode: code });
  }

  // Row Level Security / privilege errors. 42501 is Postgres' generic
  // "insufficient_privilege", which is what PostgREST returns for a policy
  // rejection.
  if (code === "42501" || candidate.status === 401 || candidate.status === 403) {
    return new DataError(
      "PERMISSION_DENIED",
      "You do not have permission to do that in this workspace.",
      { cause: error, dbCode: code, details }
    );
  }

  if (code === "PGRST116" || (code && POSTGREST_MESSAGES[code])) {
    return new DataError("NOT_FOUND", POSTGREST_MESSAGES[code] ?? "The requested record was not found.", { cause: error, dbCode: code });
  }

  if (code && CONSTRAINT_MESSAGES[code]) {
    return new DataError("CONSTRAINT_VIOLATION", CONSTRAINT_MESSAGES[code], { cause: error, dbCode: code, details });
  }

  // Network-level failures. `fetch` surfaces these as TypeError with a
  // "Failed to fetch" message rather than a typed error.
  if (error instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(message)) {
    return new DataError("NETWORK", "Could not reach the server. Check your connection and try again.", { cause: error, retryable: true });
  }
  if (/timeout|timed out|abort/i.test(message)) {
    return new DataError("TIMEOUT", "The request timed out. Please try again.", { cause: error, retryable: true });
  }

  return new DataError("DATABASE", message || fallbackMessage, { cause: error, dbCode: code, details });
};

/**
 * Unwraps a supabase-js `{ data, error }` result.
 *
 * Throws a `DataError` when `error` is set, otherwise returns `data`. Using
 * this everywhere is what guarantees a database error can never be mistaken
 * for "no rows".
 */
export const unwrap = <T>(result: { data: T; error: unknown }, context?: string): T => {
  if (result.error) {
    const normalised = toDataError(result.error, context ?? "Database request failed.");
    if (context) {
      throw new DataError(normalised.code, normalised.message, {
        dbCode: normalised.dbCode,
        details: normalised.details,
        retryable: normalised.retryable,
        cause: normalised
      });
    }
    throw normalised;
  }
  return result.data;
};

/** Client-side validation failure, for input rejected before hitting Postgres. */
export const validationError = (message: string): DataError => new DataError("VALIDATION", message);