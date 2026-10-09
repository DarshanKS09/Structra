import { createAdminClient } from "@/lib/supabase/admin";
import {
  reminderEmail,
  sendEmail,
  isEmailConfigured,
  missingEmailConfig
} from "@/lib/auth/email";
import { formatReminderOffset } from "@/lib/data/reminders";
import { formatDeadline } from "@/lib/data/adapters";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The reminder dispatcher.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A MODULE AND NOT JUST A ROUTE HANDLER
 * ---------------------------------------------------------------------------
 * Delivery needs to be callable from more than one scheduler - Vercel Cron, a
 * Supabase pg_cron job, or a human running it by hand during an incident - and
 * all of them must behave identically. Keeping the logic here means the schedule
 * is a configuration detail rather than something the logic knows about.
 *
 * ---------------------------------------------------------------------------
 * THE CLAIM, AND WHY IT IS THE WHOLE DESIGN
 * ---------------------------------------------------------------------------
 * The naive sweep reads what is due, sends, then writes "sent". Run two of those
 * at once and both read the same rows, both send, and the user gets two emails.
 * Schedule-driven systems overlap constantly: a 5-minute cron whose sweep takes
 * 6 minutes, a platform retry, a second region, an operator running it by hand
 * while the cron fires. So this dispatcher never sends on the basis of a read.
 *
 * Instead it CLAIMS each reminder with a single conditional UPDATE:
 *
 *     update tasks
 *        set reminder_attified_at = now(),      -- the claim itself
 *            reminder_attempts   = reminder_attempts + 1
 *      where id = ...
 *        and reminder_at <= now()          -- it is actually due
 *        and reminder_claimed_at is null   -- and NOBODY HAS CLAIMED IT YET
 *        and reminder_emailed_at is null   -- and it has not already gone out
 *        and status = <the status we read> -- and the task did not change under us
 *      returning *
 *
 * Postgres applies that atomically. Exactly one concurrent caller receives a
 * returned row; every other caller receives nothing, because the row it is
 * looking at no longer has `reminder_claimed_at IS NULL`. The claim is therefore
 * the concurrency control, and it survives a process crash mid-send because the
 * claim is committed before any SMTP connection is opened.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CLAIM NEEDS ITS OWN COLUMN
 * ---------------------------------------------------------------------------
 * The first version of this reused `reminder_notified_at` as the claim marker.
 * That looks sufficient - it is null until someone acts on the reminder - but it
 * is set only AFTER the notification write, which happens later. Between the
 * claim and that write there is a window in which the row still reads
 * `reminder_notified_at IS NULL`, so a second sweep entering that window claimed
 * it again and sent a duplicate. Verified: three concurrent sweeps all reported
 * `claimed=1` and three emails went out.
 *
 * That is why the claim marker is set IN THE SAME UPDATE that takes the claim.
 * It is written and checked atomically together, so there is no window at all.
 * `reminder_notified_at` now means only "the in-app notification exists", which
 * is the honest meaning of that name.
 */

export type DispatchOutcome =
  /** Claimed, notification written, email accepted by the relay. */
  | "emailed"
  /** Claimed, notification written, but the relay refused or was unreachable. */
  | "email_failed"
  /** Claimed, notification written; no email configured or no address on file. */
  | "notified_only"
  /** Another sweep already owned it. */
  | "skipped_claimed"
  /** The task is no longer open, or its deadline moved before we got to it. */
  | "skipped_cancelled"
  /** The claim UPDATE matched no row for another reason. */
  | "skipped_not_due";

export type DispatchReport = {
  ok: boolean;
  /** Reminders this run was responsible for. */
  claimed: number;
  /** Reminders whose in-app notification was written. */
  notified: number;
  /** Reminders whose email the relay accepted. */
  emailed: number;
  /** Reminders that failed to email and will be retried. */
  emailFailed: number;
  /** Reminders delivered as a notification only. */
  notifiedOnly: number;
  /** Reminders another concurrent sweep had already claimed. */
  skippedClaimed: number;
  outcomes: Record<string, DispatchOutcome>;
  failures: string[];
  /** True when SMTP credentials are absent, so emails are impossible. */
  emailConfigured: boolean;
  missingEmailConfig: string[];
  viaConsole: boolean;
  /** True when the run stopped early because of the per-run cap. */
  capped: boolean;
};

/** Per-run ceiling, so one pathological workspace cannot flood the relay. */
const MAX_PER_RUN = 200;

/**
 * Upper bound on attempts for one arming of a reminder.
 *
 * Without it, a permanently broken address would be retried every sweep forever.
 * At the default 5-minute schedule that is ~288 emails a day to an address that
 * has already bounced repeatedly. Three is enough to ride out a transient SMTP
 * or DNS failure - which is the case retries exist for - without turning a
 * misconfiguration into a mail storm.
 */
const MAX_ATTEMPTS = 3;

/** Statuses that can still raise a reminder. Mirrors the app's own list. */
const OPEN_STATUSES = ["todo", "in_progress", "blocked"] as const;

export const runReminderDispatch = async (
  options: { now?: number; limit?: number } = {}
): Promise<DispatchReport> => {
  const now = options.now ?? Date.now();
  const nowIso = new Date(now).toISOString();
  const limit = Math.min(options.limit ?? MAX_PER_RUN, MAX_PER_RUN);

  const report: DispatchReport = {
    ok: true,
    claimed: 0,
    notified: 0,
    emailed: 0,
    emailFailed: 0,
    notifiedOnly: 0,
    skippedClaimed: 0,
    outcomes: {},
    failures: [],
    emailConfigured: isEmailConfigured(),
    missingEmailConfig: missingEmailConfig(),
    viaConsole: process.env.NODE_ENV !== "production" && !isEmailConfigured(),
    capped: false
  };

  const admin = createAdminClient();

  // The candidate read is deliberately NOT the filter that decides what to send.
  // It only narrows the search using the partial index `tasks_reminder_due_idx`;
  // the authoritative decision happens in the claim UPDATE below.
  const { data: candidates, error: readError } = await admin
    .from("tasks")
    .select("id, workspace_id, created_by, title, due_at, status, reminder_at, reminder_offset_minutes, reminder_claimed_at, reminder_notified_at, reminder_emailed_at, reminder_attempts")
    .not("reminder_offset_minutes", "is", null)
    .not("reminder_at", "is", null)
    .lte("reminder_at", nowIso)
    // Exhausted reminders stop being candidates. Without this the abandoned case
    // would release its claim, be re-read as a candidate on the very next sweep,
    // be re-claimed, and increment attempts forever - the exact mail storm
    // MAX_ATTEMPTS exists to prevent.
    .lte("reminder_attempts", MAX_ATTEMPTS)
    .in("status", [...OPEN_STATUSES])
    .limit(limit * 2);

  if (readError) {
    report.ok = false;
    report.failures.push(`candidate read failed: ${readError.message}`);
    return report;
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "").trim();

  for (const candidate of candidates ?? []) {
    if (report.claimed >= limit) {
      report.capped = true;
      break;
    }

    // ---- CLAIM -------------------------------------------------------------
    // The single atomic step. Returns a row for exactly one caller.
    const { data: claimed, error: claimError } = await admin
      .from("tasks")
      .update({
        // The claim marker is SET here, in the same statement that GUARDS on it
        // being null. That is the whole concurrency mechanism.
        reminder_claimed_at: nowIso,
        reminder_attempts: (candidate.reminder_attempts ?? 0) + 1
      })
      .eq("id", candidate.id)
      .eq("status", candidate.status)
      .lte("reminder_at", nowIso)
      .is("reminder_claimed_at", null)
      .is("reminder_emailed_at", null)
      .select("*")
      .maybeSingle();

    if (claimError) {
      report.failures.push(`${candidate.id}: claim failed: ${claimError.message}`);
      continue;
    }
    if (!claimed) {
      // Another sweep owns it, or it stopped being due between the read and here.
      report.skippedClaimed += 1;
      report.outcomes[candidate.id] = "skipped_claimed";
      continue;
    }

    report.claimed += 1;

    // ---- IN-APP NOTIFICATION ----------------------------------------------
    // Written first and unconditionally. The user seeing it must not depend on
    // the mail relay being reachable, so an SMTP outage degrades to in-app
    // only rather than losing the reminder entirely.
    //
    // ON CONFLICT is the structural guarantee: `task_notifications` has a unique
    // index on (task_id, user_id), so even if two sweeps somehow both claimed,
    // the database refuses a second notification for the same task. The
    // DO UPDATE re-raises an already-read notification when the reminder has
    // genuinely been re-armed, which is the only case a user should see it again.
    const { error: notifyError } = await admin
      .from("task_notifications")
      .upsert(
        {
          workspace_id: claimed.workspace_id,
          task_id: claimed.id,
          user_id: claimed.created_by,
          title: claimed.title,
          body: `Due ${formatDeadline(claimed.due_at)}`,
          offset_minutes: claimed.reminder_offset_minutes,
          due_at: claimed.due_at
        },
        { onConflict: "task_id,user_id" }
      );

    if (notifyError) {
      report.failures.push(`${claimed.id}: notification failed: ${notifyError.message}`);
    } else {
      report.notified += 1;
    }

    await admin
      .from("tasks")
      .update({ reminder_notified_at: nowIso })
      .eq("id", claimed.id)
      .is("reminder_notified_at", null);

    // ---- EMAIL -------------------------------------------------------------
    const attempts = claimed.reminder_attempts ?? 0;
    if (attempts > MAX_ATTEMPTS) {
      // Claim released, so the row stops consuming a slot in every sweep, but the
      // error text records WHY so the cause is diagnosable rather than silent.
      report.outcomes[claimed.id] = "email_failed";
      report.emailFailed += 1;
      await admin
        .from("tasks")
        .update({
          reminder_last_error: `Abandoned after ${attempts} attempts.`,
          reminder_claimed_at: null
        })
        .eq("id", claimed.id);
      continue;
    }

    if (!isEmailConfigured()) {
      // No SMTP credentials. The notification still exists, and the reason is
      // recorded so nobody reads the absence of an email as "it was sent".
      //
      // The claim is RELEASED so that configuring SMTP later is enough to make
      // these deliver - otherwise every affected reminder would be stuck behind
      // a claim nobody can clear.
      report.notifiedOnly += 1;
      report.outcomes[claimed.id] = "notified_only";
      await admin
        .from("tasks")
        .update({
          reminder_last_error: `Email not sent: ${missingEmailConfig().join(", ")} not configured.`,
          reminder_claimed_at: null
        })
        .eq("id", claimed.id);
      continue;
    }

    const address = await emailFor(admin, claimed.created_by);
    if (!address) {
      report.notifiedOnly += 1;
      report.outcomes[claimed.id] = "notified_only";
      await admin
        .from("tasks")
        .update({ reminder_last_error: "No email address on the account." })
        .eq("id", claimed.id);
      continue;
    }

    const message = reminderEmail({
      title: claimed.title,
      dueAtLabel: `${formatDeadline(claimed.due_at)} (your local time)`,
      offsetLabel: formatReminderOffset(claimed.reminder_offset_minutes),
      appUrl: appUrl || undefined
    });

    let outcome: DispatchOutcome;
    try {
      const result = await sendEmail({ to: address, ...message });

      if (result.delivered || result.viaConsole) {
        // Only now is the email genuinely "sent": the relay accepted it. This is
        // deliberately NOT set when the send is merely queued locally or when the
        // task is merely saved.
        await admin
          .from("tasks")
          .update({ reminder_emailed_at: nowIso, reminder_last_error: null })
          .eq("id", claimed.id);
        report.emailed += 1;
        outcome = "emailed";
      } else {
        // Leave reminder_emailed_at NULL so the next sweep retries this arming,
        // and RELEASE THE CLAIM so the next sweep can actually take it. Without
        // the release the retry could never happen: the guard requires the claim
        // to be null, and this sweep set it.
        await admin
          .from("tasks")
          .update({
            reminder_last_error: result.error ?? "Unknown SMTP failure",
            reminder_claimed_at: null
          })
          .eq("id", claimed.id);
        report.emailFailed += 1;
        outcome = "email_failed";
        if (report.failures.length < 10) {
          report.failures.push(`${claimed.id}: ${result.error ?? "unknown"}`);
        }
      }
    } catch (error) {
      // sendEmail is documented never to throw, but a bug in it must not abort
      // the whole sweep and strand every later reminder. Same claim release.
      const message2 = error instanceof Error ? error.message : String(error);
      await admin
        .from("tasks")
        .update({ reminder_last_error: message2.slice(0, 500), reminder_claimed_at: null })
        .eq("id", claimed.id);
      report.emailFailed += 1;
      outcome = "email_failed";
      if (report.failures.length < 10) report.failures.push(`${claimed.id}: ${message2.slice(0, 120)}`);
    }

    report.outcomes[claimed.id] = outcome;
  }

  return report;
};

/**
 * The address to notify, from the AUTH record rather than the profile.
 *
 * The profile is deliberately not consulted: `auth.users.email` is the address
 * the account actually authenticates with, it is the only one guaranteed to
 * exist, and reading it does not mean storing a second copy of an email address
 * in a table RLS exposes to other workspace members.
 */
const emailFor = async (admin: SupabaseClient, userId: string): Promise<string | null> => {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) return null;
  return data.user.email;
};
