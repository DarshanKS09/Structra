import type { NextApiRequest, NextApiResponse } from "next";
import { clientIp, readString, requireMethod } from "@/lib/auth/api";
import { requestRegistrationOtp } from "@/lib/auth/registration";

/**
 * POST /api/auth/otp/request
 *
 * Step 1 of registration: email address -> verification code.
 *
 * Server-side generation, HMAC storage and Brevo delivery all happen here. The
 * browser never sees a code, a digest, or the pepper.
 *
 * The response is intentionally identical whether or not the address already
 * has an account, so this endpoint cannot be used to discover who is
 * registered. If an account does exist, the recipient is told by email instead.
 */
// NOTE: the body-size limit must stay an inline literal. Next.js statically
// analyses a route's exported `config` and ignores values imported from
// another module, which silently drops the limit.
export const config = { api: { bodyParser: { sizeLimit: "8kb" } } };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (!requireMethod(req, res, ["POST"])) return;

  const email = readString(req.body, "email");

  const result = await requestRegistrationOtp(email, clientIp(req));

  if (!result.ok) {
    if (result.retryAfterSeconds) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
    }
    res.status(result.code === "INVALID_EMAIL" ? 400 : result.code === "RATE_LIMITED" ? 429 : 503).json({
      ok: false,
      error: result.message,
      code: result.code,
      ...(result.retryAfterSeconds ? { retryAfterSeconds: result.retryAfterSeconds } : {})
    });
    return;
  }

  // Deliberately vague, and identical in both the existing-account and
  // new-account cases. `delivery` reports whether the mail was actually sent so
  // the UI can explain a genuine outage.
  res.status(200).json({
    ok: true,
    message: "If that address can be registered, a verification code is on its way.",
    delivery: result.delivered ? (result.viaConsole ? "console" : "email") : "failed"
  });
}