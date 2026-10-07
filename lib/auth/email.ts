import nodemailer, { type Transporter } from "nodemailer";

/**
 * Transactional email delivery via Brevo SMTP.
 *
 * ---------------------------------------------------------------------------
 * WHY SMTP
 * ---------------------------------------------------------------------------
 * Delivery moved from the Brevo HTTPS API to the SMTP relay. The API key path
 * was rejected by Brevo with `401 token is invalid or expired`; the SMTP relay
 * uses a separate credential pair (`BREVO_SMTP_LOGIN` / `BREVO_SMTP_PASSWORD`)
 * obtained from Brevo's *SMTP & API* page, which is frequently the credential
 * that is actually usable on a given account.
 *
 * This replaces ONLY the transport. OTP generation, HMAC digests, expiry, rate
 * limiting, verification and account creation are untouched, and the exported
 * interface is unchanged, so `lib/auth/registration.ts` needs no edits.
 *
 * Brevo remains a delivery service only. It cannot create users, authenticate
 * anyone, or influence sessions - Supabase Auth still owns identity entirely.
 *
 * ---------------------------------------------------------------------------
 * SECURITY
 * ---------------------------------------------------------------------------
 * Server-only: throws if evaluated in a browser. None of the SMTP variables are
 * `NEXT_PUBLIC_`, so Next.js never inlines them into the client bundle.
 *
 * STARTTLS is required on every non-secure port, so the login and password are
 * never transmitted in plaintext even if a relay offered to accept them.
 *
 * When the SMTP configuration is absent the service falls back to a
 * development-only console transport. That fallback is hard-disabled in
 * production, so missing configuration can never silently mean "print the OTP to
 * a log".
 */

const DEFAULT_TIMEOUT_SECONDS = 10;

/** Fallbacks for host/port only. Credentials and sender are never defaulted. */
const DEFAULT_SMTP_HOST = "smtp-relay.brevo.com";
const DEFAULT_SMTP_PORT = 587;

export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigError";
  }
}

if (typeof window !== "undefined") {
  throw new Error("lib/auth/email.ts is server-only and must not be imported into client code.");
}

type SmtpConfig = {
  host: string;
  port: number;
  login: string;
  password: string;
  senderEmail: string;
  senderName: string;
  timeoutSeconds: number;
  /** True when the port is configured (or defaulted) and everything else is present. */
  complete: boolean;
  /** Which required values are missing - used to build an actionable error. */
  missing: string[];
};

const readInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const config = (): SmtpConfig => {
  const host = process.env.BREVO_SMTP_HOST?.trim() || DEFAULT_SMTP_HOST;
  const port = readInt(process.env.BREVO_SMTP_PORT, DEFAULT_SMTP_PORT);
  const login = process.env.BREVO_SMTP_LOGIN?.trim() ?? "";
  const password = process.env.BREVO_SMTP_PASSWORD?.trim() ?? "";
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim() ?? "";
  const senderName = process.env.BREVO_SENDER_NAME?.trim() || "Structra";
  const timeoutSeconds = readInt(process.env.BREVO_TIMEOUT_SECONDS, DEFAULT_TIMEOUT_SECONDS);

  const missing: string[] = [];
  if (!login) missing.push("BREVO_SMTP_LOGIN");
  if (!password) missing.push("BREVO_SMTP_PASSWORD");
  if (!senderEmail) missing.push("BREVO_SENDER_EMAIL");

  return {
    host,
    port,
    login,
    password,
    senderEmail,
    senderName,
    timeoutSeconds,
    complete: missing.length === 0,
    missing
  };
};

export const isEmailConfigured = (): boolean => config().complete;

/** Names of the required variables that are absent. Safe to log - no values. */
export const missingEmailConfig = (): string[] => config().missing;

/**
 * True when the no-credential development fallback would be used.
 * Never true in production.
 */
export const isUsingConsoleTransport = (): boolean =>
  !isEmailConfigured() && process.env.NODE_ENV !== "production";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendResult = {
  delivered: boolean;
  /** True when the message was written to the server console instead. */
  viaConsole: boolean;
  error?: string;
  /**
   * Server-assigned SMTP message id.
   *
   * Its presence is the strongest available evidence that the relay accepted
   * and queued the message. It does not guarantee inbox delivery.
   */
  messageId?: string;
};

/**
 * Builds the transporter.
 *
 * Cached per configuration so repeated sends reuse one pooled connection rather
 * than re-handshaking TLS for every OTP. The cache key deliberately excludes the
 * password's value - only whether it is set - so the secret never becomes part
 * of a map key.
 */
let cached: { key: string; transporter: Transporter } | null = null;

const transporterFor = (settings: SmtpConfig): Transporter => {
  const key = `${settings.host}:${settings.port}:${settings.login}:${settings.password ? "set" : "unset"}`;
  if (cached && cached.key === key) return cached.transporter;

  const isSecure = settings.port === 465;

  const transporter = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    // 465 negotiates TLS implicitly; every other port uses STARTTLS.
    secure: isSecure,
    auth: { user: settings.login, pass: settings.password },
    // Never send credentials over an unencrypted channel. This turns a relay
    // that lacks STARTTLS into a hard failure rather than a silent downgrade.
    requireTLS: !isSecure,
    // Nodemailer honours this for connection, greeting, socket and handshake.
    connectionTimeout: settings.timeoutSeconds * 1000,
    greetingTimeout: settings.timeoutSeconds * 1000,
    socketTimeout: settings.timeoutSeconds * 1000,
    tls: {
      rejectUnauthorized: true,
      minVersion: "TLSv1.2"
    }
  });

  cached = { key, transporter };
  return transporter;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Shared layout so every Structra email looks the same. */
const layout = (heading: string, body: string, footer: string): string => `<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#020617;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px;background:#0f172a;border:1px solid #1e293b;border-radius:16px;padding:28px;">
        <tr><td>
          <p style="margin:0 0 4px;color:#38bdf8;font-size:13px;letter-spacing:.08em;text-transform:uppercase;">Structra</p>
          <h1 style="margin:0 0 16px;color:#f8fafc;font-size:22px;line-height:1.3;">${escapeHtml(heading)}</h1>
          ${body}
          <p style="margin:24px 0 0;color:#64748b;font-size:12px;line-height:1.6;">${escapeHtml(footer)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

export const otpEmail = (code: string, minutes: number): { subject: string; html: string; text: string } => {
  const heading = "Your Structra verification code";
  const body = `
    <p style="margin:0 0 12px;color:#cbd5e1;font-size:15px;line-height:1.6;">Enter this code to finish creating your account:</p>
    <p style="margin:0 0 20px;">
      <span style="display:inline-block;background:#0ea5e9;color:#082f49;font-size:32px;font-weight:700;letter-spacing:.32em;padding:14px 22px;border-radius:12px;">${escapeHtml(code)}</span>
    </p>
    <p style="margin:0;color:#94a3b8;font-size:14px;line-height:1.6;">It expires in ${minutes} minutes and can only be used once.</p>`;
  const footer =
    "If you did not request this code you can safely ignore this email. Structra will never ask you for it by phone or chat.";
  return {
    subject: `${code} is your Structra verification code`,
    html: layout(heading, body, footer),
    text: `${code}\n\nYour Structra verification code expires in ${minutes} minutes.\n\nIf you did not request this, ignore this email.`
  };
};

export const existingAccountEmail = (): { subject: string; html: string; text: string } => {
  const heading = "You already have a Structra account";
  const body = `
    <p style="margin:0;color:#cbd5e1;font-size:15px;line-height:1.6;">We did not send a verification code because an account already exists for this address.</p>
    <p style="margin:16px 0 0;color:#94a3b8;font-size:14px;line-height:1.6;">Sign in with your email and password instead, or reset your password if you have forgotten it.</p>`;
  const footer = "If this is not your address, you can ignore this email.";
  return {
    subject: "You already have a Structra account",
    html: layout(heading, body, footer),
    text: "You already have a Structra account. Sign in with your email and password."
  };
};

/**
 * Turns a low-level SMTP/nodemailer failure into something an operator can act
 * on, without leaking the login or password.
 */
const describeSmtpError = (error: unknown, settings: SmtpConfig): string => {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string })?.code ?? "";

  if (code === "EAUTH" || /535|invalid credentials|authentication failed|535 5\.7\.8/i.test(message)) {
    return `SMTP authentication was rejected by ${settings.host}. Check BREVO_SMTP_LOGIN and BREVO_SMTP_PASSWORD (Brevo -> SMTP & API).`;
  }
  if (code === "ETIMEDOUT" || /timed? ?out/i.test(message)) {
    return `SMTP connection to ${settings.host}:${settings.port} timed out after ${settings.timeoutSeconds}s.`;
  }
  if (code === "ECONNREFUSED" || /ECONNREFUSED|connect ECONNREFUSED/i.test(message)) {
    return `Could not connect to ${settings.host}:${settings.port}. Check BREVO_SMTP_HOST and BREVO_SMTP_PORT.`;
  }
  if (/550|553|unauthorized sender|sender.*not/i.test(message)) {
    return `Brevo rejected the sender address. ${settings.senderEmail} must be verified in your Brevo account.`;
  }
  if (/certificate|self.signed|unable to verify/i.test(message)) {
    return `TLS verification failed against ${settings.host}. ${message.slice(0, 160)}`;
  }
  return `SMTP delivery failed: ${message.slice(0, 200)}`;
};

/**
 * Sends a transactional email over SMTP.
 *
 * Never throws for a delivery failure: the caller decides how to react, and an
 * email outage must not be reported to a user as a broken code.
 */
export const sendEmail = async (message: EmailMessage): Promise<SendResult> => {
  const settings = config();

  if (!settings.complete) {
    if (process.env.NODE_ENV === "production") {
      return {
        delivered: false,
        viaConsole: false,
        error: `Email delivery is not configured. Missing: ${settings.missing.join(", ")}.`
      };
    }

    // Development fallback so the flow is testable without SMTP credentials.
    console.info(
      `[email:console] to=${message.to} subject=${message.subject}\n${message.text}`
    );
    return { delivered: true, viaConsole: true };
  }

  try {
    const info = await transporterFor(settings).sendMail({
      from: { name: settings.senderName, address: settings.senderEmail },
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text
    });

    return {
      delivered: true,
      viaConsole: false,
      ...(typeof info?.messageId === "string" ? { messageId: info.messageId } : {})
    };
  } catch (error) {
    const described = describeSmtpError(error, settings);
    console.error("[email] SMTP delivery failed:", described);
    return { delivered: false, viaConsole: false, error: described };
  }
};

/**
 * Verifies connectivity and credentials without sending anything.
 *
 * `verify()` performs the TCP connection, the TLS handshake and SMTP AUTH, then
 * closes the connection. That makes it the right check for distinguishing
 * "credentials are wrong" from "the network is unreachable".
 */
export const verifySmtpConnection = async (): Promise<{ ok: boolean; error?: string }> => {
  const settings = config();
  if (!settings.complete) {
    return {
      ok: false,
      error: `SMTP is not configured. Missing: ${settings.missing.join(", ")}.`
    };
  }
  try {
    await transporterFor(settings).verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeSmtpError(error, settings) };
  }
};