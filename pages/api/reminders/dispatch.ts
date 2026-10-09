import type { NextApiRequest, NextApiResponse } from "next";
import { runReminderDispatch } from "@/lib/reminders/dispatch";

/**
 * POST /api/reminders/dispatch
 *
 * Runs one reminder sweep: claims every reminder that is due, writes its
 * persistent in-app notification, and emails it.
 *
 * ---------------------------------------------------------------------------
 * WHY A SCHEDULED ENDPOINT RATHER THAN A BROWSER TIMER
 * ---------------------------------------------------------------------------
 * A reminder that depends on the tab staying open is not a reminder - closing the
 * laptop silently drops it. All delivery is here, on the server, and is expected
 * to be invoked on a schedule.
 *
 * ---------------------------------------------------------------------------
 * AUTHORISATION - FAILS CLOSED
 * ---------------------------------------------------------------------------
 * This endpoint is unauthenticated by default unless a secret is configured, and
 * that was the single most dangerous line in the previous version:
 *
 *     if (CRON_SECRET) { ...check... }        // no else -> OPEN when unset
 *
 * With `CRON_SECRET` absent - which is the case on this project - anyone could
 * POST here and drive up to 200 Brevo sends per call, with no rate limit and no
 * IP check. That is a mail-relay abuse primitive pointed at the sender domain,
 * and it is exactly how a sending domain gets throttled or suspended.
 *
 * So the check is now unconditional in production. A missing secret in production
 * returns 503 and sends NOTHING, rather than defaulting to open. Local
 * development without a secret is still allowed, because that is genuinely
 * convenient and genuinely not a risk - but it is reported in the response so
 * "it worked" is never mistaken for "it is protected".
 *
 * ---------------------------------------------------------------------------
 * SCHEDULING
 * ---------------------------------------------------------------------------
 * See `supabase/scheduler.sql` and `vercel.json` in this repository. Either
 * schedule calls this route; nothing else needs to change.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENCY AND CONCURRENCY
 * ---------------------------------------------------------------------------
 * Delivery is claimed with an atomic conditional UPDATE inside
 * `lib/reminders/dispatch.ts`, so overlapping runs cannot double-send. This route
 * is a thin, authenticated shell around that.
 */

const CRON_SECRET = process.env.CRON_SECRET?.trim() || "";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }

  const isProduction = process.env.NODE_ENV === "production";

  // Unconditional in production. This is the whole point of the change: a missing
  // secret must mean "refuse", not "allow everyone".
  if (isProduction && !CRON_SECRET) {
    res.status(503).json({
      ok: false,
      error:
        "CRON_SECRET is not configured, so this endpoint refuses to run. Set it and retry."
    });
    return;
  }

  if (CRON_SECRET) {
    const presented = req.headers.authorization;
    // Constant-time comparison, and the length is not leaked: a length mismatch
    // simply fails, same as a value mismatch.
    if (presented !== `Bearer ${CRON_SECRET}`) {
      res.status(401).json({ ok: false, error: "Unauthorized." });
      return;
    }
  }

  try {
    const report = await runReminderDispatch();

    // Partial success is still 200: the sweep ran and recorded real outcomes.
    // A 5xx would tell the scheduler to retry immediately, which would re-claim
    // and re-fail the same rows in a tight loop.
    res.status(200).json({
      ...report,
      // Which of the two states this endpoint is actually in. Never let an open
      // endpoint look like a protected one.
      scheduled: Boolean(CRON_SECRET),
      protectedEndpoint: Boolean(CRON_SECRET),
      devMode: !CRON_SECRET,
      scheduler: isProduction ? "cron" : "manual"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ ok: false, error: "The reminder sweep failed.", detail: message });
  }
}
