import type { NextApiRequest, NextApiResponse } from "next";
import { readString, requireMethod } from "@/lib/auth/api";
import { completeRegistration } from "@/lib/auth/registration";

/**
 * POST /api/auth/otp/complete
 *
 * Step 3 of registration: registration token + password -> Supabase Auth account.
 *
 * The Supabase user is created here and only here, and only after the OTP was
 * verified. The database's `handle_new_user` trigger then provisions the
 * profile, personal workspace and owner membership - this endpoint deliberately
 * does not create any of those, so the bootstrap logic exists in one place.
 *
 * No session is established. The client redirects to the login page and
 * authenticates there.
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

  const registrationToken = readString(req.body, "registrationToken");
  const password = readString(req.body, "password");

  const result = await completeRegistration(registrationToken, password);

  if (!result.ok) {
    const status =
      result.code === "WEAK_PASSWORD" ? 400
        : result.code === "ACCOUNT_EXISTS" ? 409
          : result.code === "INVALID_TOKEN" ? 410
            : 503;

    res.status(status).json({ ok: false, error: result.message, code: result.code });
    return;
  }

  // 201 Created: a new Supabase Auth user now exists.
  res.status(201).json({
    ok: true,
    email: result.email,
    message: "Account created. Sign in to continue."
  });
}