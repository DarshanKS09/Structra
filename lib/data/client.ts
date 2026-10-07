import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";
import { unwrap, toDataError } from "@/lib/data/errors";

/**
 * Accessor for the browser Supabase client used by the data layer.
 *
 * A function rather than a module-level constant so that no client is
 * constructed at import time. `createClient()` reads environment variables and
 * throws when they are missing; deferring construction keeps that from breaking
 * module evaluation during server-side rendering, where this layer is not used.
 */
export const db = () => createClient();

export type DataClient = ReturnType<typeof db>;

/** Narrowed client type for modules that need to pass a client around. */
export type SupabaseDataClient = ReturnType<typeof createClient> & {
  __brand?: Database;
};

/**
 * Produces an `archived_at` value the database will accept.
 *
 * WHY THIS IS NEEDED
 *
 * `created_at` is written by the DATABASE clock (`default now()`), while a
 * client-supplied `archived_at` uses the CLIENT clock. `notes` and `habits` both
 * carry a CHECK of `archived_at >= created_at`.
 *
 * Archiving a row seconds after creating it therefore fails whenever the client
 * is even slightly behind the server - typically by a few hundred milliseconds
 * inside the same second, because the two clocks are independent. The write is
 * rejected with a constraint violation and the item appears unarchivable.
 *
 * Clamping against the row's own `created_at` removes that failure mode without
 * needing a migration. The extra read happens only on archive, which is a
 * deliberate user action, so it is not on any hot path.
 */
export const safeArchiveTimestamp = async (
  fetchCreatedAt: () => Promise<string | null>
): Promise<string> => {
  const now = new Date();
  try {
    const createdAt = await fetchCreatedAt();
    if (createdAt) {
      const created = new Date(createdAt);
      if (!Number.isNaN(created.getTime()) && created.getTime() > now.getTime()) {
        // PRECISION: Postgres stores timestamptz with microsecond precision, a
        // JS Date with milliseconds. Re-serialising created_at therefore
        // truncates the sub-millisecond remainder - .736127 becomes .736000 -
        // which makes archived_at STRICTLY LESS than created_at and fails the
        // schema's CHECK. One millisecond of headroom absorbs that loss.
        return new Date(created.getTime() + 1).toISOString();
      }
    }
  } catch {
    // Fall back to the client clock; the write may still be accepted.
  }
  return now.toISOString();
};

export const requireUserId = async (): Promise<string> => {
  const { data, error } = await db().auth.getUser();
  if (error) throw toDataError(error, "Could not read the current session.");
  const id = data.user?.id;
  if (!id) {
    throw toDataError(
      { message: "No authenticated user" },
      "You must be signed in to perform this action."
    );
  }
  return id;
};

/**
 * Re-exported so data modules can `import { db, unwrap } from "@/lib/data/client"`
 * in one line.
 */
export { unwrap };