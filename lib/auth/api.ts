import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Helpers shared by the registration API routes.
 *
 * Three things every route needs and none should re-implement:
 *
 *  1. A uniform response shape, so the client never has to guess.
 *  2. A method allow-list, so a GET cannot reach a mutating handler.
 *  3. Client-IP extraction, which feeds OTP rate limiting. Read from
 *     `x-forwarded-for` because Next.js runs behind a proxy in production.
 *
 * Responses are deliberately generic: nothing returned here reveals whether an
 * email address has an account.
 */

export type ApiSuccess<T> = { ok: true } & T;
export type ApiFailure = { ok: false; error: string; code?: string; retryAfterSeconds?: number; attemptsRemaining?: number };
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export const clientIp = (req: NextApiRequest): string | null => {
  const forwarded = req.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (value) {
    const first = value.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers["x-real-ip"];
  return Array.isArray(real) ? (real[0] ?? null) : (real ?? null);
};

/** Rejects any method other than the ones a route declares. */
export const requireMethod = (
  req: NextApiRequest,
  res: NextApiResponse,
  allowed: string[]
): boolean => {
  if (allowed.includes(req.method ?? "")) return true;
  res.setHeader("Allow", allowed);
  res.status(405).json({ ok: false, error: "Method not allowed." });
  return false;
};

/** Body fields arrive as `unknown`; narrow without casting the whole object. */
export const readString = (body: unknown, field: string): string => {
  if (typeof body !== "object" || body === null) return "";
  const value = (body as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
};

/**
 * A numeric body field, or null when absent/not numeric.
 *
 * Used where the value is a hint rather than the authority (for example a file
 * size, which the destination also enforces).
 */
export const readNumber = (body: unknown, field: string): number | null => {
  if (typeof body !== "object" || body === null) return null;
  const value = (body as Record<string, unknown>)[field];
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
};

/**
 * Maximum accepted request body for the registration routes.
 *
 * A registration body is a handful of short fields, so anything large is
 * either a mistake or an attempt to waste server resources. Each route applies
 * this through `export const config = { api: { bodyParser: { sizeLimit } } }`.
 */
export const REGISTRATION_BODY_SIZE_LIMIT = "8kb";