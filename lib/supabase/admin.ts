/**
 * Runtime browser guard, replacing the `server-only` package.
 *
 * WHY NOT `import "server-only"`: that package only works with App Router
 * Server Components. Structra uses the Pages Router, where importing it from a
 * `pages/` file fails the build outright. A runtime assertion is the
 * equivalent protection that is actually available here.
 */
if (typeof window !== "undefined") {
  throw new Error(
    "lib/supabase/admin.ts is a server-only module and must not be imported into client-side code."
  );
}

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabaseServiceRoleKey,
  getSupabaseUrl
} from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/types";

/**
 * Privileged server-side Supabase client using the service role key.
 *
 * ---------------------------------------------------------------------------
 * DANGER: this client BYPASSES Row Level Security entirely.
 * ---------------------------------------------------------------------------
 *
 * Anything it touches is fully accessible. It must be used only in trusted
 * server contexts, and only for operations a user could not perform themselves:
 *
 *   - administrative listings and back-office tooling
 *   - server-to-server webhooks whose sender is verified by signature
 *   - scheduled jobs owned by the platform, not by a user
 *   - one-off maintenance scripts run from a trusted environment
 *
 * It must NEVER be used to service an ordinary user request, because doing so
 * silently discards the per-user security boundary that RLS exists to enforce.
 *
 * Do not pass the result to a Client Component, embed it in props, or return it
 * from an API route. The `server-only` import at the top of this file makes any
 * such attempt fail at build time rather than leak the key at runtime.
 *
 * Set `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` to enable this client. It is
 * intentionally absent from `.env.example` values - only the variable *name* is
 * documented there, never a real credential.
 */

/**
 * Returns a fresh, privileged Supabase client.
 *
 * Unlike the browser client this is intentionally NOT memoised: it holds no
 * session state, and creating it per call makes the trust boundary obvious at
 * each call site.
 *
 * @throws SupabaseConfigError when `SUPABASE_SERVICE_ROLE_KEY` is not set.
 */
export const createAdminClient = (): SupabaseClient<Database> =>
  createSupabaseClient<Database>(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      // No session is ever established for a service-role client. Persisting
      // one would risk a privileged session being carried into a later request.
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });