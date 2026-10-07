/**
 * Browser-side caller for the registration API.
 *
 * Holds no secrets and makes no authorisation decision: it POSTs to the server
 * routes and renders whatever comes back. The OTP itself is never visible to
 * this code - it only ever travels server -> email.
 *
 * Every failure is surfaced as a real error. A failed request never resolves to
 * a success-shaped result, so the UI cannot show a false confirmation.
 */

export type RequestCodeResponse = {
  ok: boolean;
  message?: string;
  delivery?: "email" | "console" | "failed";
  error?: string;
  code?: string;
  retryAfterSeconds?: number;
};

export type VerifyCodeResponse = {
  ok: boolean;
  registrationToken?: string;
  expiresInSeconds?: number;
  error?: string;
  code?: string;
  attemptsRemaining?: number;
};

export type CompleteResponse = {
  ok: boolean;
  email?: string;
  message?: string;
  error?: string;
  code?: string;
};

/** Reads a JSON body even when the status is an error. */
const read = async <T>(response: Response): Promise<T> => {
  try {
    return (await response.json()) as T;
  } catch {
    return { ok: false, error: "The server returned an unexpected response." } as T;
  }
};

const post = async (path: string, body: Record<string, string>): Promise<Response> => {
  try {
    return await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch {
    // Network-level failure: surfaced as a thrown error by the caller wrapper.
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
};

export const requestCode = async (email: string): Promise<RequestCodeResponse> => {
  const response = await post("/api/auth/otp/request", { email });
  return read<RequestCodeResponse>(response);
};

export const verifyCode = async (email: string, code: string): Promise<VerifyCodeResponse> => {
  const response = await post("/api/auth/otp/verify", { email, code });
  return read<VerifyCodeResponse>(response);
};

export const completeRegistration = async (
  registrationToken: string,
  password: string
): Promise<CompleteResponse> => {
  const response = await post("/api/auth/otp/complete", { registrationToken, password });
  return read<CompleteResponse>(response);
};

/**
 * Sends the registration email to the next screen.
 *
 * Only the address travels; the verification step re-sends it. Keeping it in the
 * query string is acceptable because an email address is not a secret, and it
 * survives a page refresh on the verification screen - which a refresh during
 * OTP entry is very likely to cause.
 */
export const registrationHref = (email: string) =>
  `/verify-otp?email=${encodeURIComponent(email)}`;