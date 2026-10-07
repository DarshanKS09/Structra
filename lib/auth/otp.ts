import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Server-side OTP generation, digesting and comparison.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE IS SERVER-ONLY
 * ---------------------------------------------------------------------------
 * It reads `OTP_PEPPER`, which is the key that makes a stolen digest useless.
 * It must never be imported into client code. Every consumer lives under
 * `pages/api/`, which Next.js executes only on the server.
 *
 * ---------------------------------------------------------------------------
 * WHY HMAC AND NOT A PLAIN HASH
 * ---------------------------------------------------------------------------
 * A one-time code is six digits: about 20 bits, one million possibilities.
 * Anyone able to read `code_digest` could brute-force a bare SHA-256 of such a
 * code essentially instantly. HMAC-SHA256 keyed with a secret that never leaves
 * the server makes that infeasible: without the key, each guess is
 * computationally independent.
 *
 * The email address is mixed into the digest input so that the same code issued
 * for two different addresses produces two different digests. Without this, an
 * observer with many digests could correlate codes across accounts.
 */

/** Six digits, generated with a CSPRNG. */
export const OTP_LENGTH = 6;
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;

/** Thrown when a required server secret is missing. */
export class OtpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OtpConfigError";
  }
}

/**
 * The pepper.
 *
 * Read through a function so the value is only dereferenced at call time and
 * never captured in a module-level constant that could be logged.
 */
const pepper = (): string => {
  const value = process.env.OTP_PEPPER;
  if (!value || value.trim().length < 32) {
    throw new OtpConfigError(
      "OTP_PEPPER is missing or too short. Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\""
    );
  }
  return value;
};

/** Lower-cased and trimmed, so lookups cannot be dodged by capitalisation. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** A cryptographically random six-digit code, zero-padded. */
export const generateOtp = (): string => {
  const max = 10 ** OTP_LENGTH;
  return randomInt(0, max).toString().padStart(OTP_LENGTH, "0");
};

/**
 * HMAC-SHA256 over purpose || email || code.
 *
 * The separators matter: without them, ("ab", "c") and ("a", "bc") could
 * produce the same input. A fixed-length purpose prefix and an explicit
 * delimiter make the encoding unambiguous.
 */
export const digestOtp = (purpose: string, email: string, code: string): Buffer => {
  const message = `${purpose.length}:${purpose}|${normalizeEmail(email)}|${code}`;
  return createHmac("sha256", pepper()).update(message, "utf8").digest();
};

/** Expiry timestamp for a newly issued challenge. */
export const otpExpiry = (from: Date = new Date()): Date =>
  new Date(from.getTime() + OTP_TTL_MINUTES * 60_000);

/**
 * Constant-time digest comparison.
 *
 * `timingSafeEqual` requires equal-length buffers, so a length mismatch is
 * reported as a non-match rather than throwing. The length of an HMAC-SHA256 is
 * fixed, so a mismatch here means corrupt data, not a wrong guess.
 */
export const digestsMatch = (a: Buffer, b: Buffer): boolean => {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
};

/** A code is exactly six digits. Rejects anything else before any hashing. */
export const isWellFormedOtp = (code: string): boolean => new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code);

/**
 * Registration completion token.
 *
 * Mints a signed proof that *this caller* verified the code. Without it, anyone
 * who knew a target's email address could call the completion endpoint after
 * that person verified their own code and set a password on their account.
 *
 * Bound to the challenge id, so it cannot be replayed against a different
 * challenge, and short-lived so a leaked token has a small window.
 */
export const mintRegistrationToken = (
  challengeId: string,
  email: string,
  expiresAt: Date
): string => {
  // Each component is base64url-encoded before joining. Two reasons:
  //   1. base64url's alphabet excludes ".", so splitting on "." is unambiguous.
  //      Joining raw values does not work: an ISO timestamp contains dots
  //      ("2026-01-01T12:00:00.000Z") and would corrupt the parse.
  //   2. The email address is not readable from the token.
  const payload = [
    Buffer.from(challengeId, "utf8").toString("base64url"),
    Buffer.from(normalizeEmail(email), "utf8").toString("base64url"),
    Buffer.from(expiresAt.toISOString(), "utf8").toString("base64url")
  ].join(".");

  const signature = createHmac("sha256", pepper()).update(`reg|${payload}`, "utf8").digest("base64url");
  return `${payload}.${signature}`;
};

export type ParsedRegistrationToken = {
  challengeId: string;
  email: string;
  expiresAt: Date;
};

/**
 * Verifies a registration token.
 *
 * Returns null for any malformed, tampered or expired token - the caller cannot
 * distinguish the cases, which is deliberate.
 */
export const verifyRegistrationToken = (token: string): ParsedRegistrationToken | null => {
  // payload has exactly 3 base64url components, then the signature.
  const parts = token.split(".");
  if (parts.length !== 4) return null;

  const [challengeIdB64, emailB64, isoB64, signature] = parts;
  const payload = `${challengeIdB64}.${emailB64}.${isoB64}`;

  const expected = createHmac("sha256", pepper())
    .update(`reg|${payload}`, "utf8")
    .digest("base64url");

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const decode = (value: string): string | null => {
    try {
      return Buffer.from(value, "base64url").toString("utf8");
    } catch {
      return null;
    }
  };

  const challengeId = decode(challengeIdB64);
  const decodedEmail = decode(emailB64);
  const iso = decode(isoB64);
  if (challengeId === null || decodedEmail === null || iso === null) return null;

  // A UUID id is required; anything else is a forged or corrupt token.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(challengeId)) return null;

  const expiresAt = new Date(iso);
  if (Number.isNaN(expiresAt.getTime())) return null;
  if (expiresAt.getTime() <= Date.now()) return null;

  return { challengeId, email: normalizeEmail(decodedEmail), expiresAt };
};

/** Password policy, enforced before the account is created. */
export const PASSWORD_MIN_LENGTH = 8;

export type PasswordCheck = { ok: true } | { ok: false; message: string };

/**
 * Validates password strength.
 *
 * Deliberately conservative: length, character variety, and rejection of
 * obvious structure. Supabase performs the authoritative check - this only
 * avoids a pointless network round trip for an obviously weak password.
 */
export const checkPassword = (password: string): PasswordCheck => {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: `Use at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (!/[a-z]/.test(password)) return { ok: false, message: "Include a lowercase letter." };
  if (!/[A-Z]/.test(password)) return { ok: false, message: "Include an uppercase letter." };
  if (!/\d/.test(password)) return { ok: false, message: "Include a number." };
  if (/^(password|qwerty|12345678|letmein|admin|welcome)/i.test(password)) {
    return { ok: false, message: "That password is too common." };
  }
  if (/(.)\1{3,}/.test(password)) {
    return { ok: false, message: "Avoid repeating the same character." };
  }
  return { ok: true };
};