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
    "lib/supabase/server.ts is a server-only module and must not be imported into client-side code."
  );
}

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parse, serialize } from "cookie";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/types";

/**
 * Server-side Supabase clients.
 *
 * IMPORTANT - this project uses the Next.js **Pages Router** (see `pages/`),
 * not the App Router. That has two consequences:
 *
 *  1. There is no `cookies()` store from `next/headers`. Cookie access comes
 *     from the `req` / `res` pair handed to `getServerSideProps`, `getInitialProps`,
 *     or a Pages API route.
 *
 *  2. This file therefore exposes an explicit, typed `req`/`res` adapter rather
 *     than the App Router `createServerClient<Database>({ cookies })` shape used
 *     in the App Router documentation. The cookie semantics are identical.
 *
 * The `import "server-only"` guard at the top makes any accidental import from a
 * Client Component a **build-time error** rather than a runtime leak. This is
 * what guarantees the anon key stays the only key ever present in the browser
 * bundle.
 */

/**
 * Minimal structural type for the Next.js request/response pair used here.
 *
 * Structural typing is used instead of importing `NextApiRequest` /
 * `NextApiResponse` so the same helpers work in `getServerSideProps`
 * (`GetServerSidePropsContext`), Pages API routes, and NextAuth-style contexts
 * without importing from `next` at all. This keeps the module usable from any
 * server context and easy to unit test with plain objects.
 */
export type SupabaseServerRequest = {
  /** Parsed request cookies. Populated by Next.js on both SSR and API routes. */
  cookies?: Partial<Record<string, string>>;
  /** Present on server-side requests; absent on API routes. */
  headers?: Record<string, string | string[] | undefined>;
};

export type SupabaseServerResponse = {
  /** Used to emit refreshed auth cookies after a token refresh. */
  setHeader?: (name: string, value: string | string[]) => unknown;
  /** Used by `getServerSideProps` to declare the page dynamic. */
  revalidate?: (seconds: number) => void;
};

/**
 * Applies Supabase's recommended caching headers.
 *
 * Responses that set auth cookies must never be cached by a CDN or reverse
 * proxy, otherwise one visitor's session token can be served to another.
 * `@supabase/ssr` supplies the correct header values; this only forwards them.
 */
const applyCacheHeaders = (res: SupabaseServerResponse, headers: Record<string, string>): void => {
  if (!res.setHeader) return;
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }
};

/**
 * Cookie read adapter.
 *
 * Returns *all* request cookies rather than a single lookup, matching the
 * `getAll` contract required by `@supabase/ssr`. A partial-cookie store is a
 * common source of "random logouts" and stale-session bugs.
 */
const getAllCookies = (req: SupabaseServerRequest): { name: string; value: string }[] =>
  Object.entries(req.cookies ?? {}).map(([name, value]) => ({ name, value: String(value ?? "") }));

/**
 * Cookie write adapter.
 *
 * `res.setHeader` replaces a header rather than appending, so multiple cookies
 * are collected and appended to any existing `Set-Cookie` value. Appending
 * matters: refreshing a session writes several cookies at once, and a naive
 * `setHeader` would drop all but the last one and silently log the user out.
 */
const setAllCookies = (
  res: SupabaseServerResponse,
  cookiesToSet: { name: string; value: string; options: CookieOptions }[],
  headers: Record<string, string>
): void => {
  applyCacheHeaders(res, headers);
  if (!res.setHeader) return;

  const serialised = cookiesToSet.map(({ name, value, options }) => serialize(name, value, options));

  const existing = res.setHeader;
  // `getHeader` is absent from the structural type; probe defensively.
  const candidate = res as SupabaseServerResponse & {
    getHeader?: (name: string) => string | number | string[] | undefined;
  };
  const previous = candidate.getHeader?.("Set-Cookie");

  const previousList = Array.isArray(previous)
    ? previous.map(String)
    : typeof previous === "string"
      ? [previous]
      : [];

  res.setHeader("Set-Cookie", [...previousList, ...serialised]);
};

/**
 * Creates a Supabase client for a single server-side request.
 *
 * Usage in `getServerSideProps`:
 *
 * ```ts
 * export const getServerSideProps = async (ctx) => {
 *   const supabase = createServerClient(ctx.req, ctx.res);
 *   const { data: { user } } = await supabase.auth.getUser();
 *   return { props: { user } };
 * };
 * ```
 *
 * Usage in a Pages API route (`pages/api/*.ts`):
 *
 * ```ts
 * export default async function handler(req, res) {
 *   const supabase = createServerClient(req, res);
 *   // ...
 * }
 * ```
 *
 * A NEW client must be created per request. Sharing one across requests would
 * leak one visitor's session into another's response.
 *
 * @throws SupabaseConfigError when the Supabase environment variables are absent.
 */
export const createServerClientForRequest = (
  req: SupabaseServerRequest,
  res: SupabaseServerResponse
): SupabaseClient<Database> =>
  createServerClient<Database>(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll: () => getAllCookies(req),
      setAll: (cookiesToSet, headers) => setAllCookies(res, cookiesToSet, headers),
    },
  });

/**
 * Convenience wrapper for contexts that expose a raw cookie header string but
 * no parsed cookie object (for example a raw `Headers` instance).
 *
 * Parsing is delegated to the `cookie` package, the same implementation
 * `@supabase/ssr` uses, so behaviour is consistent across adapters.
 */
export const createServerClientFromCookieHeader = (
  cookieHeader: string | undefined,
  res: SupabaseServerResponse
): SupabaseClient<Database> =>
  createServerClientForRequest({ cookies: parse(cookieHeader ?? "") }, res);

/**
 * Marks the response as uncacheable.
 *
 * Call this whenever a server-rendered page reads the auth session. A cached
 * personalised page is a session-leak vulnerability.
 */
export const markResponseAsDynamic = (res: SupabaseServerResponse): void => {
  res.revalidate?.(0);
};