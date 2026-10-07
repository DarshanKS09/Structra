/**
 * Centralised, validated access to Supabase environment variables.
 *
 * Why this module exists:
 *
 *  1. Next.js performs *static* replacement of `process.env.NEXT_PUBLIC_*`.
 *     It only works when the property is accessed as a literal string. Dynamic
 *     lookups such as `process.env[name]` silently yield `undefined` in the
 *     browser bundle. Every variable is therefore read exactly once, below, as
 *     a literal access.
 *
 *  2. It separates *public* configuration (safe to ship to the browser) from
 *     *server-only* configuration (must never reach the browser bundle).
 *
 *  3. It fails loudly and early with an actionable message instead of letting
 *     `createClient` throw an opaque error deep inside the SDK.
 *
 * This module contains no client instances and no `server-only` guard, so it is
 * safe to import from both server and browser code. Do NOT import
 * `SUPABASE_SERVICE_ROLE_KEY` from here into anything client-side - use
 * `lib/supabase/admin.ts` for privileged server access instead.
 */

/** Error thrown when required Supabase configuration is missing or malformed. */
export class SupabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseConfigError";
  }
}

/**
 * Public configuration. These two values are embedded into the client bundle
 * by design and are safe to expose: access to data is gated by Row Level
 * Security policies, not by the key itself.
 *
 * Never place the service role key in a `NEXT_PUBLIC_*` variable.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Server-only configuration. Not prefixed with `NEXT_PUBLIC_`, so Next.js never
 * inlines it into the client bundle. Read exclusively via
 * `getSupabaseServiceRoleKey()` in `lib/supabase/admin.ts`.
 */
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Trims a value and treats whitespace-only strings as absent. */
const normalise = (value: string | undefined): string => value?.trim() ?? "";

const readUrl = (): string => normalise(supabaseUrl);
const readAnonKey = (): string => normalise(supabaseAnonKey);
const readServiceRoleKey = (): string => normalise(supabaseServiceRoleKey);

/**
 * Returns true when the public Supabase configuration is present.
 *
 * Useful for rendering an onboarding or "not configured" state instead of
 * crashing. Does not imply that the credentials are valid - only that they
 * were supplied.
 */
export const isSupabaseConfigured = (): boolean =>
  readUrl().length > 0 && readAnonKey().length > 0;

/**
 * Returns the Supabase project URL, or `null` when it is not configured.
 *
 * Use this for optional/soft dependencies. Use `getSupabaseUrl()` when a
 * missing value should fail loudly.
 */
export const getSupabaseUrlOrNull = (): string | null => {
  const url = readUrl();
  return url.length > 0 ? url : null;
};

/**
 * Returns the publishable/anon key, or `null` when it is not configured.
 *
 * This key is designed to be public. Never return the service role key from a
 * function reachable by client code.
 */
export const getSupabaseAnonKeyOrNull = (): string | null => {
  const key = readAnonKey();
  return key.length > 0 ? key : null;
};

/**
 * Returns the Supabase project URL or throws `SupabaseConfigError`.
 */
export const getSupabaseUrl = (): string => {
  const url = readUrl();
  if (!url) {
    throw new SupabaseConfigError(
      "NEXT_PUBLIC_SUPABASE_URL is missing. Copy .env.example to .env.local and set it to your project URL (https://<project-ref>.supabase.co)."
    );
  }
  return url;
};

/**
 * Returns the publishable/anon key or throws `SupabaseConfigError`.
 */
export const getSupabaseAnonKey = (): string => {
  const key = readAnonKey();
  if (!key) {
    throw new SupabaseConfigError(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY is missing. Copy .env.example to .env.local and set it to your project's publishable (sb_publishable_...) or anon key."
    );
  }
  return key;
};

/**
 * Returns the service role key or throws `SupabaseConfigError`.
 *
 * Server-only: this key bypasses Row Level Security entirely. It is exposed
 * exclusively through `lib/supabase/admin.ts`, which carries the `server-only`
 * guard that makes accidental client usage a build-time error.
 */
export const getSupabaseServiceRoleKey = (): string => {
  const key = readServiceRoleKey();
  if (!key) {
    throw new SupabaseConfigError(
      "SUPABASE_SERVICE_ROLE_KEY is missing. It is optional and only required for privileged server operations. Copy .env.example to .env.local and set it if you need it."
    );
  }
  return key;
};

/** Returns true when the optional service role key is configured. */
export const isSupabaseAdminConfigured = (): boolean =>
  readServiceRoleKey().length > 0;