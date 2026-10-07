import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/config";

/**
 * Reusable Next.js middleware helper for Supabase session refresh.
 *
 * ---------------------------------------------------------------------------
 * NOT YET WIRED UP. There is deliberately no `middleware.ts` in this project.
 * ---------------------------------------------------------------------------
 *
 * Next.js executes `middleware.ts` on **every** matched request. Registering it
 * now would make the app call Supabase on each request using credentials that
 * do not exist yet, breaking the current build. Authentication is out of scope
 * for this step, so the helper is provided ready to use in the auth phase.
 *
 * To enable it later, create `middleware.ts` at the project root:
 *
 * ```ts
 * import { NextResponse } from "next/server";
 * import { updateSession } from "@/lib/supabase/middleware";
 *
 * export async function middleware(request: NextRequest) {
 *   return await updateSession(request);
 * }
 *
 * export const config = {
 *   matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
 * };
 * ```
 *
 * Why this exists (and why it is not optional boilerplate): Supabase access
 * tokens are short-lived. When one expires, the client must refresh it using the
 * stored refresh token. If a Server Component reads the session *without* this
 * step having run, it receives a stale/expired token, treats the visitor as
 * anonymous, and the user appears to be randomly signed out. Middleware is what
 * keeps the cookie fresh ahead of every render.
 *
 * Note this helper intentionally does NOT call `supabase.auth.getUser()`. That
 * is deliberate: doing so would add a network round trip to *every* request
 * before authentication is actually needed. The cookie refresh is what matters
 * here; authorisation decisions belong in the data layer via RLS.
 */

/**
 * Refreshes the Supabase auth session and returns the response to continue
 * with, carrying any refreshed cookies.
 *
 * @param request The incoming request.
 * @returns A `NextResponse` with updated cookies, or the same response with a
 *          `{ supabaseResponse }` header attached when the Supabase env vars are
 *          not configured yet, so the app still runs without credentials.
 */
export const updateSession = async (request: NextRequest): Promise<NextResponse> => {
  let supabaseResponse = NextResponse.next({ request });

  // When credentials are absent, skip refresh entirely and let the request
  // through untouched. This keeps the app bootable before the environment is set
  // up, rather than failing every request.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return supabaseResponse;
  }

  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Always write onto the *request* as well as the response, so any
        // Server Component reading cookies during this render sees the
        // refreshed values rather than the stale incoming ones.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      }
    }
  });

  // Touching the client triggers the lazy session load and, when needed, a
  // token refresh that writes back through `setAll`.
  //
  // `getClaims()` is preferred over `getUser()` here because it verifies the JWT
  // locally instead of making a network call. It is safe at this stage because no
  // authorisation decision is being made from the result.
  await supabase.auth.getClaims();

  return supabaseResponse;
};