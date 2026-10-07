import { createAdminClient } from "@/lib/supabase/admin";
import {
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MINUTES,
  digestOtp,
  digestsMatch,
  generateOtp,
  isWellFormedOtp,
  mintRegistrationToken,
  normalizeEmail,
  otpExpiry,
  checkPassword
} from "@/lib/auth/otp";
import { existingAccountEmail, otpEmail, sendEmail } from "@/lib/auth/email";

/**
 * Server-side registration logic.
 *
 * Owns the whole registration state machine and is the only place that can
 * create a Supabase Auth user. Called exclusively from `pages/api/auth/**`.
 *
 * State machine, enforced in the database as well as here:
 *
 *   (none) --request--> challenge live
 *   live --verify(ok)--> verified        (max 5 attempts, 10-minute TTL)
 *   live --verify(bad)--> live, attempts+1
 *   live --expire/5 bad--> dead
 *   verified --complete--> consumed, user created
 *   live/verified --new request--> superseded by a fresh challenge
 *
 * Enumeration safety: every public entry point returns the same generic result
 * whether or not the address already has an account. The difference is only ever
 * expressed in the email body the recipient receives, which an attacker asking
 * about someone else's address cannot read.
 */

const PURPOSE = "registration" as const;

/** Rate limits, per email address and per source IP. */
const RESEND_LIMIT_PER_EMAIL = 3;
const RESEND_LIMIT_PER_IP = 10;
const RESEND_WINDOW_MINUTES = 15;
const VERIFY_LIMIT_PER_MINUTE = 10;

export type RegistrationOutcome =
  | { ok: true; /** Email delivery outcome, for server-side logging only. */ delivered: boolean; viaConsole: boolean; accountExists: boolean }
  | { ok: false; code: RegistrationErrorCode; message: string; retryAfterSeconds?: number };

export type VerifyOutcome =
  | { ok: true; registrationToken: string; expiresInSeconds: number }
  | { ok: false; code: VerifyErrorCode; message: string; attemptsRemaining?: number };

export type CompleteOutcome =
  | { ok: true; email: string }
  | { ok: false; code: CompleteErrorCode; message: string };

export type RegistrationErrorCode =
  | "INVALID_EMAIL"
  | "RATE_LIMITED"
  | "EMAIL_FAILED"
  | "UNAVAILABLE";

export type VerifyErrorCode =
  | "INVALID_CODE"
  | "EXPIRED"
  | "TOO_MANY_ATTEMPTS"
  | "RATE_LIMITED"
  | "UNAVAILABLE";

export type CompleteErrorCode =
  | "INVALID_TOKEN"
  | "WEAK_PASSWORD"
  | "ACCOUNT_EXISTS"
  | "UNAVAILABLE";

/** Message used for every rejected code, so failures are indistinguishable. */
const GENERIC_INVALID_CODE = "That code is not correct.";

/** Guard against a missing migration producing a confusing error. */
const TABLE_MISSING_HINT =
  "Registration is not available yet. The OTP challenges table is missing - apply the latest Supabase migration.";

/**
 * Cached check that the OTP table exists.
 *
 * WHY THIS IS CHECKED FIRST, BEFORE THE ACCOUNT LOOKUP
 *
 * The existing-account branch never writes a challenge, while the new-account
 * branch does. If the table were missing, only the new-account branch would fail
 * - so a `200` for an address that already has an account and a `503` for one
 * that does not would be a perfect account-enumeration oracle.
 *
 * Probing once, up front, means both branches short-circuit identically and the
 * response can no longer depend on whether the address is registered.
 *
 * Cached for a short period to avoid a probe query on every request; the TTL
 * means applying the migration does not require a server restart.
 */
let tableProbe: { value: boolean; at: number } | null = null;
const TABLE_PROBE_TTL_MS = 30_000;

const isOtpTableAvailable = async (): Promise<boolean> => {
  const now = Date.now();
  if (tableProbe && now - tableProbe.at < TABLE_PROBE_TTL_MS) return tableProbe.value;

  let value = false;
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("otp_challenges").select("id").limit(1);
    value = !error;
    if (error) {
      console.error("[registration] otp_challenges probe failed:", error.message);
    }
  } catch (error) {
    console.error("[registration] otp_challenges probe threw:", error);
    value = false;
  }

  tableProbe = { value, at: now };
  return value;
};

/**
 * `bytea` <-> Buffer.
 *
 * Postgres bytea is transported by PostgREST as a `\x`-prefixed hex string. The
 * prefix is optional on the way in and tolerated on the way out, so both a value
 * we wrote and one returned by another client decode identically.
 */
const toByteaHex = (value: Buffer): string => `\\x${value.toString("hex")}`;

const fromByteaHex = (value: string): Buffer | null => {
  try {
    return Buffer.from(value.replace(/^\\x/i, ""), "hex");
  } catch {
    return null;
  }
};

const isMissingTable = (message: string): boolean =>
  /otp_challenges|does not exist|schema cache|42P01/i.test(message);

const emailIsPlausible = (email: string): boolean => {
  const trimmed = email.trim();
  return trimmed.length >= 5 && trimmed.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
};

/** Does an Auth account already exist for this address? */
const accountExists = async (email: string): Promise<boolean> => {
  const admin = createAdminClient();
  // `listUsers` is filtered by the auth service, not by a query on a table we
  // can read directly.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  const target = normalizeEmail(email);
  return (data?.users ?? []).some((user) => normalizeEmail(user.email ?? "") === target);
};

/**
 * Suppresses a send when the address has been used too recently.
 *
 * Counts challenges rather than tracking counters in memory, so the limit holds
 * across serverless instances and restarts.
 */
const withinResendLimit = async (email: string, ip: string | null): Promise<{ allowed: boolean; retryAfterSeconds?: number }> => {
  const admin = createAdminClient();
  const since = new Date(Date.now() - RESEND_WINDOW_MINUTES * 60_000).toISOString();

  const { count: byEmail } = await admin
    .from("otp_challenges")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gte("created_at", since);

  if ((byEmail ?? 0) >= RESEND_LIMIT_PER_EMAIL) {
    return { allowed: false, retryAfterSeconds: RESEND_WINDOW_MINUTES * 60 };
  }

  if (ip) {
    const { count: byIp } = await admin
      .from("otp_challenges")
      .select("id", { count: "exact", head: true })
      .eq("request_ip", ip)
      .gte("created_at", since);

    if ((byIp ?? 0) >= RESEND_LIMIT_PER_IP) {
      return { allowed: false, retryAfterSeconds: RESEND_WINDOW_MINUTES * 60 };
    }
  }

  return { allowed: true };
};

/**
 * Step 1 - request a code.
 *
 * Issuing a new code supersedes any live challenge for the address, so the
 * previous code stops working immediately.
 */
export const requestRegistrationOtp = async (
  rawEmail: string,
  ip: string | null
): Promise<RegistrationOutcome> => {
  const email = normalizeEmail(rawEmail);
  if (!emailIsPlausible(email)) {
    return { ok: false, code: "INVALID_EMAIL", message: "Enter a valid email address." };
  }

  try {
    // Checked before anything else so the response cannot depend on whether the
    // address already has an account. See isOtpTableAvailable.
    if (!(await isOtpTableAvailable())) {
      console.error("[registration] otp_challenges table is unavailable; apply the latest migration");
      return { ok: false, code: "UNAVAILABLE", message: TABLE_MISSING_HINT };
    }

    const exists = await accountExists(email);

    // Rate limit regardless of whether the account exists, so response timing
    // and behaviour do not reveal account existence.
    const limit = await withinResendLimit(email, ip);
    if (!limit.allowed) {
      return {
        ok: false,
        code: "RATE_LIMITED",
        message: "Too many codes requested. Please wait a few minutes and try again.",
        retryAfterSeconds: limit.retryAfterSeconds
      };
    }

    if (exists) {
      // A different email, but the same generic API response. Telling the
      // requester here would be account enumeration.
      const result = await sendEmail({ to: email, ...existingAccountEmail() });
      return { ok: true, delivered: result.delivered, viaConsole: result.viaConsole, accountExists: true };
    }

    const code = generateOtp();
    const admin = createAdminClient();

    // Supersede any previous challenge: one live code per address at a time.
    await admin
      .from("otp_challenges")
      .update({ consumed_at: new Date().toISOString() })
      .eq("email", email)
      .eq("purpose", PURPOSE)
      .is("consumed_at", null);

    const { error: insertError } = await admin.from("otp_challenges").insert({
      email,
      purpose: PURPOSE,
      // `bytea` crosses PostgREST as a `\x`-prefixed hex string, not a Buffer.
      code_digest: toByteaHex(digestOtp(PURPOSE, email, code)),
      attempts: 0,
      max_attempts: OTP_MAX_ATTEMPTS,
      expires_at: otpExpiry().toISOString(),
      request_ip: ip
    });

    if (insertError) {
      if (isMissingTable(insertError.message)) {
        console.error("[registration] otp_challenges unavailable:", insertError.message);
        return { ok: false, code: "UNAVAILABLE", message: TABLE_MISSING_HINT };
      }
      throw new Error(insertError.message);
    }

    const result = await sendEmail({ to: email, ...otpEmail(code, OTP_TTL_MINUTES) });
    if (!result.delivered) {
      console.error("[registration] email delivery failed:", result.error);
      return {
        ok: false,
        code: "EMAIL_FAILED",
        message: "We could not send the code. Please try again in a moment."
      };
    }

    return { ok: true, delivered: true, viaConsole: result.viaConsole, accountExists: false };
  } catch (error) {
    console.error("[registration] request failed:", error);
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "Registration is temporarily unavailable. Please try again."
    };
  }
};

/**
 * Step 2 - verify the code.
 *
 * A correct code marks the challenge verified and returns a short-lived signed
 * token. That token is what authorises step 3; the code itself is never reused.
 */
export const verifyRegistrationOtp = async (
  rawEmail: string,
  rawCode: string,
  ip: string | null
): Promise<VerifyOutcome> => {
  const email = normalizeEmail(rawEmail);
  const code = rawCode.trim();

  // Reject malformed input before touching the database, but with the same
  // generic message as any other failure.
  if (!isWellFormedOtp(code)) {
    return { ok: false, code: "INVALID_CODE", message: GENERIC_INVALID_CODE };
  }

  try {
    const admin = createAdminClient();

    // Verify-rate limit: count challenges this address has already exercised.
    if (ip) {
      const since = new Date(Date.now() - 60_000).toISOString();
      const { count } = await admin
        .from("otp_challenges")
        .select("id", { count: "exact", head: true })
        .eq("email", email)
        .gte("created_at", since);
      if ((count ?? 0) > VERIFY_LIMIT_PER_MINUTE) {
        return {
          ok: false,
          code: "RATE_LIMITED",
          message: "Too many attempts. Please wait a moment and try again."
        };
      }
    }

    const { data: challenge, error } = await admin
      .from("otp_challenges")
      .select("*")
      .eq("email", email)
      .eq("purpose", PURPOSE)
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (isMissingTable(error.message)) {
        return { ok: false, code: "UNAVAILABLE", message: TABLE_MISSING_HINT };
      }
      throw new Error(error.message);
    }

    // No live challenge: expired, superseded, exhausted or never issued. All
    // collapse to one message.
    if (!challenge) {
      return { ok: false, code: "INVALID_CODE", message: GENERIC_INVALID_CODE };
    }

    if (challenge.attempts >= challenge.max_attempts) {
      // Burn the challenge so a correct code cannot rescue an exhausted one.
      await admin
        .from("otp_challenges")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", challenge.id);
      return {
        ok: false,
        code: "TOO_MANY_ATTEMPTS",
        message: "Too many incorrect attempts. Request a new code."
      };
    }

    if (new Date(challenge.expires_at).getTime() <= Date.now()) {
      await admin
        .from("otp_challenges")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", challenge.id);
      return { ok: false, code: "EXPIRED", message: "That code has expired. Request a new one." };
    }

    const digest = fromByteaHex(challenge.code_digest);
    if (!digest) {
      // Corrupt digest: treat exactly like a wrong code rather than crashing.
      return { ok: false, code: "INVALID_CODE", message: GENERIC_INVALID_CODE };
    }
    const matches = digestsMatch(digest, digestOtp(PURPOSE, email, code));

    if (!matches) {
      const { data: updated } = await admin
        .from("otp_challenges")
        .update({ attempts: challenge.attempts + 1 })
        .eq("id", challenge.id)
        .eq("attempts", challenge.attempts) // optimistic: do not race a parallel attempt
        .select("attempts, max_attempts")
        .maybeSingle();

      const remaining = updated
        ? Math.max(0, updated.max_attempts - updated.attempts)
        : Math.max(0, challenge.max_attempts - challenge.attempts - 1);

      if (remaining <= 0) {
        await admin
          .from("otp_challenges")
          .update({ consumed_at: new Date().toISOString() })
          .eq("id", challenge.id);
        return {
          ok: false,
          code: "TOO_MANY_ATTEMPTS",
          message: "Too many incorrect attempts. Request a new code."
        };
      }

      return {
        ok: false,
        code: "INVALID_CODE",
        message: GENERIC_INVALID_CODE,
        attemptsRemaining: remaining
      };
    }

    // Correct code. Mark verified and mint the completion token.
    const verifiedUntil = new Date(Date.now() + 10 * 60_000);
    const { error: verifyError } = await admin
      .from("otp_challenges")
      .update({ verified_at: new Date().toISOString() })
      .eq("id", challenge.id)
      .is("verified_at", null);

    if (verifyError) throw new Error(verifyError.message);

    return {
      ok: true,
      registrationToken: mintRegistrationToken(challenge.id, email, verifiedUntil),
      expiresInSeconds: 10 * 60
    };
  } catch (error) {
    console.error("[registration] verify failed:", error);
    return { ok: false, code: "UNAVAILABLE", message: "Verification is temporarily unavailable." };
  }
};

/**
 * Step 3 - set a password and create the Supabase Auth account.
 *
 * This is the only place a user account is created, and it runs strictly after
 * the code has been verified. The database's existing `handle_new_user` trigger
 * then provisions the profile, personal workspace and owner membership - this
 * code does not duplicate any of that.
 */
export const completeRegistration = async (
  registrationToken: string,
  password: string
): Promise<CompleteOutcome> => {
  const { verifyRegistrationToken } = await import("@/lib/auth/otp");
  const parsed = verifyRegistrationToken(registrationToken);
  if (!parsed) {
    return { ok: false, code: "INVALID_TOKEN", message: "Your verification has expired. Please start again." };
  }

  const strength = checkPassword(password);
  if (!strength.ok) {
    return { ok: false, code: "WEAK_PASSWORD", message: strength.message };
  }

  try {
    const admin = createAdminClient();
    const { data: challenge, error } = await admin
      .from("otp_challenges")
      .select("*")
      .eq("id", parsed.challengeId)
      .eq("email", parsed.email)
      .maybeSingle();

    if (error) {
      if (isMissingTable(error.message)) {
        return { ok: false, code: "UNAVAILABLE", message: TABLE_MISSING_HINT };
      }
      throw new Error(error.message);
    }

    if (!challenge || challenge.consumed_at !== null || challenge.verified_at === null) {
      return { ok: false, code: "INVALID_TOKEN", message: "Your verification has expired. Please start again." };
    }

    if (new Date(challenge.expires_at).getTime() <= Date.now()) {
      await admin
        .from("otp_challenges")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", challenge.id);
      return { ok: false, code: "INVALID_TOKEN", message: "Your verification has expired. Please start again." };
    }

    // Guard against a second completion racing the first: claim the challenge
    // before creating the user, so a replay finds it already consumed.
    const { data: claimed, error: claimError } = await admin
      .from("otp_challenges")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", challenge.id)
      .is("consumed_at", null)
      .select("id")
      .maybeSingle();

    if (claimError) throw new Error(claimError.message);
    if (!claimed) {
      return { ok: false, code: "INVALID_TOKEN", message: "Your verification has already been used." };
    }

    const alreadyExists = await accountExists(parsed.email);
    if (alreadyExists) {
      return { ok: false, code: "ACCOUNT_EXISTS", message: "An account with that email already exists. Sign in instead." };
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: parsed.email,
      password,
      // The address was proven by the OTP, so Supabase's own confirmation email
      // is unnecessary. Nothing is sent to the user here.
      email_confirm: true,
      user_metadata: { email_verified_via: "otp" }
    });

    if (createError) {
      // Roll the claim back so a genuine failure does not burn the challenge.
      await admin.from("otp_challenges").update({ consumed_at: null }).eq("id", challenge.id);

      if (/already|registered|exists/i.test(createError.message)) {
        return { ok: false, code: "ACCOUNT_EXISTS", message: "An account with that email already exists. Sign in instead." };
      }
      throw new Error(createError.message);
    }

    // Intentionally no session is created here. The user is redirected to the
    // login page and authenticates there, as specified.
    return { ok: true, email: created.user?.email ?? parsed.email };
  } catch (error) {
    console.error("[registration] completion failed:", error);
    return { ok: false, code: "UNAVAILABLE", message: "We could not finish creating your account. Please try again." };
  }
};