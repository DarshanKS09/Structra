/**
 * Public entry point for the Supabase client layer.
 *
 * Import from `@/lib/supabase` rather than reaching into individual files. This
 * keeps the import surface stable and makes it obvious which modules are safe
 * to use from a Client Component.
 *
 * Safe for any environment:
 *   - `isSupabaseConfigured`, `getSupabaseUrl`, `getSupabaseAnonKey`, ...
 *
 * Browser / Client Components only:
 *   - `createClient` (the browser client)
 *
 * Server only (`server-only` guarded, throws if pulled into a client bundle):
 *   - `createServerClientForRequest`, `createServerClientFromCookieHeader`
 *   - `createAdminClient`              (service role - bypasses RLS)
 *   - `updateSession`                  (middleware helper, not yet wired up)
 */

export {
  SupabaseConfigError,
  isSupabaseConfigured,
  isSupabaseAdminConfigured,
  getSupabaseUrl,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrlOrNull,
  getSupabaseAnonKeyOrNull
} from "@/lib/supabase/config";

export { createClient, isSupabaseClientInitialised } from "@/lib/supabase/client";

export type { Database, Json } from "@/lib/supabase/types";