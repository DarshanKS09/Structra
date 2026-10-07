import type { NextApiRequest, NextApiResponse } from "next";
import { clientIp, readString, requireMethod } from "@/lib/auth/api";
import { verifyRegistrationOtp } from "@/lib/auth/registration";

/**
 * POST /api/auth/otp/verify
 *
 * Step 2 of registration: email + code -> a short-lived registration token.
 *
 * On success the returned token is the only thing that authorises account
 * creation. It is HMAC-signed by the server, bound to the specific challenge,
 * and short-lived, so it cannot be replayed for another address or reused after
 * the challenge is consumed.
 *
 * Every rejection carries the same generic message apart from expiry and
 * attempt exhaustion, which the user genuinely needs to act on.
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
  const code = readString(req.body, "code");

  const result = await verifyRegistrationOtp(email, code, clientIp(req));

  if (!result.ok) {
    const status =
      result.code === "RATE_LIMITED" ? 429 : result.code === "UNAVAILABLE" ? 503 : 400;

    res.status(status).json({
      ok: false,
      error: result.message,
      code: result.code,
      ...(result.attemptsRemaining !== undefined
        ? { attemptsRemaining: result.attemptsRemaining }
        : {})
    });
    return;
  }

  res.status(200).json({
    ok: true,
    registrationToken: result.registrationToken,
    expiresInSeconds: result.expiresInSeconds
  });
}