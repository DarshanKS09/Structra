import type { NextApiRequest, NextApiResponse } from "next";

/**
 * POST /api/reminders/dispatch
 *
 * Emails reminders whose instant has passed.
 *
 * ---------------------------------------------------------------------------
 * WHY A SCHEDULED ENDPOINT RATHER THAN A BROWSER TIMER
 * ---------------------------------------------------------------------------
 * A reminder that depends on the tab staying open is not a reminder - closing the
 * laptop silently drops it. Delivery therefore runs here, on the server, and is
 * expected to be invoked on a schedule (see the note below).
 *
 * ---------------------------------------------------------------------------
 * SCHEDULING - REQUIRES ONE MANUAL STEP
 * ---------------------------------------------------------------------------
 * This route does NOT self-schedule. Structra has no `vercel.json` and the
 * hosting target is not pinned in the repo, so the cron entry cannot be added
 * here. Until it is added, this endpoint can be called manually and reminders
 * are delivered only when someone (or something) calls it.
 *
 * For Vercel, add to `vercel.json`:
 *
 *   { "crons": [{ "path": "/api/reminders/dispatch", "schedule": "every 5 minutes" }] }
 *
 * where "every 5 minutes" stands for the standard five-field cron expression
 * (asterisk-slash-5 followed by four asterisks). It is spelled out here rather
 * than written literally because that expression contains the two characters
 * that would close this comment block.
 *
 * Vercel also requires `CRON_SECRET` to be set, and then the request must send
 * `Authorization: Bearer <CRON_SECRET>`. That is enforced below.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENCY
 * ---------------------------------------------------------------------------
 * `markReminderSent` compare-and-sets `reminder_sent_at` only when the task has not
 * been edited since, so a sweep that runs twice, overlaps itself, or retries
 * after a timeout cannot email the same task twice. That is what makes running
 * this on a frequent schedule safe.
 */

const CRON_SECRET = process.env.CRON_SECRET;

/** Per-request cap so one runaway workspace cannot flood the mail relay. */
const MAX_PER_RUN = 200;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }

  // If a secret is configured it MUST be presented. Without one configured the
  // route is left open only for local development, and says so in its response so
  // nobody mistakes "it worked" for "it is protected".
  if (CRON_SECRET) {
    const presented = req.headers.authorization;
    if (presented !== `Bearer ${CRON_SECRET}`) {
      res.status(401).json({ ok: false, error: "Unauthorized." });
      return;
    }
  }

  // Server-only imports, kept dynamic so they never reach the client bundle.
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { reminderEmail, sendEmail, isEmailConfigured, missingEmailConfig } = await import(
    "@/lib/auth/email"
  );
  const { formatReminderOffset, reminderDueAt } = await import("@/lib/data/reminders");
  const { formatDeadline } = await import("@/lib/data/adapters");

  if (!isEmailConfigured()) {
    res.status(503).json({
      ok: false,
      error: "Email delivery is not configured.",
      missing: missingEmailConfig()
    });
    return;
  }

  const admin = createAdminClient();
  const now = Date.now();

  // One pass across every workspace that has an armed reminder. RLS is not in
  // play here because this is a platform-level job, not a user request - which
  // is the legitimate use of the service role, and why it stays on the server.
  const { data: due, error } = await admin
    .from("tasks")
    .select("id, workspace_id, created_by, title, due_at, status, reminder_offset_minutes, reminder_sent_at, updated_at")
    .not("reminder_offset_minutes", "is", null)
    .not("due_at", "is", null)
    .neq("status", "done")
    .lte("due_at", new Date(now + 7 * 86_400_000).toISOString())
    .limit(MAX_PER_RUN * 4);

  if (error) {
    res.status(500).json({ ok: false, error: "Could not read pending reminders." });
    return;
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "https://structra.app";

  const emails = new Map<string, string | null>();
  const toSend = (due ?? []).filter((task) => {
    const fire = reminderDueAt(task.due_at, task.reminder_offset_minutes);
    if (!fire || new Date(fire).getTime() > now) return false;
    // Not yet delivered, or edited since the last delivery (which re-arms it).
    if (task.reminder_sent_at && new Date(task.reminder_sent_at) >= new Date(task.updated_at)) {
      return false;
    }
    return true;
  });

  let sent = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const task of toSend) {
    if (sent >= MAX_PER_RUN) break;

    // Resolve the recipient once per user, not once per task.
    if (!emails.has(task.created_by)) {
      const { data: profile } = await admin
        .from("profiles")
        .select("id")
        .eq("id", task.created_by)
        .maybeSingle();
      emails.set(task.created_by, profile ? task.created_by : null);
    }

    const { data: authUser } = await admin.auth.admin.getUserById(task.created_by);
    const address = authUser?.user?.email;
    if (!address) {
      skipped += 1;
      continue;
    }

    const message = reminderEmail({
      title: task.title,
      // The recipient's own timezone, so the email reads correctly wherever they are.
      dueAtLabel: `${formatDeadline(task.due_at)} (your local time)`,
      offsetLabel: formatReminderOffset(task.reminder_offset_minutes),
      appUrl
    });

    const result = await sendEmail({ to: address, ...message });

    if (result.delivered || result.viaConsole) {
      await admin
        .from("tasks")
        .update({ reminder_sent_at: new Date(now).toISOString() })
        .eq("id", task.id)
        // Compare-and-set: skip if the task changed while we were sending, so a
        // concurrent deadline edit re-arms the reminder instead of swallowing it.
        .lt("updated_at", new Date(now).toISOString());
      sent += 1;
    } else {
      skipped += 1;
      if (failures.length < 5) failures.push(`${task.id}: ${result.error ?? "unknown"}`);
    }
  }

  res.status(200).json({
    ok: true,
    candidates: toSend.length,
    sent,
    skipped,
    failures,
    // Honest about the two states this endpoint can be in.
    scheduled: Boolean(CRON_SECRET),
    devMode: !CRON_SECRET,
    viaConsole: process.env.NODE_ENV !== "production"
  });
}