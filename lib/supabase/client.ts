"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/types";

/**
 * Browser-side Supabase client.
 *
 * Used by React Client Components for all data access from the browser:
 * sign-in, sign-out, session reads, and queries.
 *
 * Design notes:
 *
 *  - `@supabase/ssr`'s `createBrowserClient` persists the auth session in
 *    *cookies* rather than `localStorage`. This is deliberate: it lets the
 *    server read the session on the initial request, so a server-rendered page
 *    can be personalised without an extra client-side round trip.
 *
 *  - The client is created lazily on first call and memoised on `globalThis`.
 *    React Strict Mode (enabled in `next.config.js`) double-invokes effects in
 *    development, and Next.js Fast Refresh re-evaluates modules on edit. Without
 *    the singleton guard each of those would create a second client with its
 *    own auth listener, producing duplicated refresh timers and "multiple
 *    clients with different storage" warnings.
 *
 *  - `createBrowserClient` is documented as safe to call with the same
 *    arguments; the memoisation is belt-and-braces for the hot-reload path.
 */

/**
 * `globalThis` augmented with a private, symbol-keyed slot for the singleton.
 *
 * A symbol key guarantees the property cannot collide with any other library
 * or with application code that may later add globals of its own.
 */
type SupabaseGlobal = typeof globalThis & {
  [SUPABASE_CLIENT_SYMBOL]?: SupabaseClient<Database>;
};

// Declared separately from the type so the computed key is a stable reference.
const SUPABASE_CLIENT_SYMBOL = Symbol.for("structra.supabase.browserClient");

const globalForSupabase = globalThis as SupabaseGlobal;

/**
 * Returns the shared browser Supabase client, creating it on first call.
 *
 * Throws `SupabaseConfigError` when the environment variables are absent, so a
 * missing configuration surfaces immediately with an actionable message.
 *
 * @example
 *   const supabase = createClient();
 *   const { data, error } = await supabase.from("items").select("*");
 */
export const createClient = (): SupabaseClient<Database> => {
  const existing = globalForSupabase[SUPABASE_CLIENT_SYMBOL];
  if (existing) return existing;

  const client = createBrowserClient<Database>(getSupabaseUrl(), getSupabaseAnonKey());

  globalForSupabase[SUPABASE_CLIENT_SYMBOL] = client;

  return client;
};

/**
 * True once `createClient()` has been called in this runtime.
 *
 * Useful for guarding optional Supabase-backed UI without relying on
 * environment variables directly.
 */
export const isSupabaseClientInitialised = (): boolean =>
  Boolean(globalForSupabase[SUPABASE_CLIENT_SYMBOL]);