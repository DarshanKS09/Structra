import { NextResponse, type NextRequest } from "next/server";

/**
 * Supabase session refresh.
 *
 * WHY THIS FILE IS NEEDED
 *
 * Supabase access tokens are short-lived. When one expires, the client must
 * refresh it using the stored refresh token, and the refreshed token has to be
 * written back into the cookie that `lib/supabase/server.ts` reads. Without a
 * middleware running ahead of every request, a server-rendered page reads an
 * expired token, treats the visitor as anonymous, and the user appears to be
 * "randomly signed out".
 *
 * Middleware is the only place that can do this reliably, because it can set
 * cookies on the response before any rendering happens.
 *
 * PAGES ROUTER COMPATIBILITY
 *
 * This uses the standard `NextRequest`/`NextResponse` middleware API, which is
 * supported by both the Pages Router and the App Router. The request/response
 * cookie bridge itself lives in `lib/supabase/middleware.ts`; this file is only
 * the wiring.
 *
 * SECURITY
 *
 * The middleware never inspects or logs the tokens it handles, and it does not
 * make authorisation decisions. It only refreshes the session. All access
 * control remains in PostgreSQL via Row Level Security, which is the real
 * security boundary.
 */
export async function middleware(request: NextRequest) {
  // Skip refresh when the project is not configured, so the app still boots
  // without credentials instead of failing every request.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return NextResponse.next({ request });
  }

  const { updateSession } = await import("@/lib/supabase/middleware");
  return await updateSession(request);
}

export const config = {
  /**
   * Run on every page and API route EXCEPT static assets and image files.
   *
   * Excluding them avoids pointless token refreshes on hundreds of asset
   * requests. The negative lookahead also keeps Next.js internals
   * (`_next/static`, `_next/image`) out of the matcher.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"
  ]
};