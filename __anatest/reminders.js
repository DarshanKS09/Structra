"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markReminderSent = exports.listPendingReminders = exports.listDueReminders = exports.setTaskReminder = exports.isReminderDue = exports.reminderDueAt = exports.formatReminderOffset = exports.REMINDER_OPTIONS = exports.REMINDER = void 0;
const client_1 = require("./stub-client.js");
const errors_1 = require("./stub-errors.js");
/**
 * Task reminders.
 *
 * ---------------------------------------------------------------------------
 * WHY A REMINDER IS NOT A ROW OF ITS OWN
 * ---------------------------------------------------------------------------
 * A reminder is a pure function of a task's deadline and a chosen offset:
 *
 *     reminder_at = due_at - reminder_offset_minutes
 *
 * Only the OFFSET is stored (`tasks.reminder_offset_minutes`). That single
 * decision removes the failure modes a separate table would introduce:
 *
 *   - Editing a deadline reschedules automatically, because there is no stored
 *     fire time to go stale. There is nothing to synchronise.
 *   - Deleting a task deletes its reminder, because there is nothing else.
 *   - Duplicates are impossible: a task has exactly one offset column.
 *   - Completing a task stops reminders, because the "due" query already
 *     excludes `status = 'done'`.
 *
 * `reminder_sent_at` exists only so dispatch is idempotent: it records that the
 * notification already went out, which is what stops a repeatedly-run sweep from
 * emailing the same task over and over.
 *
 * ---------------------------------------------------------------------------
 * TIMEZONE
 * ---------------------------------------------------------------------------
 * `due_at` is timestamptz and the offset is an integer number of minutes, so the
 * fire time is arithmetic on an absolute instant. No local-time conversion is
 * involved, which means the reminder fires at the same moment regardless of the
 * user's or the server's location - and a deadline picked as 09:00 local is
 * stored as the instant it actually refers to, so the offset is genuinely
 * "30 minutes before my 09:00", not "30 minutes before UTC midnight".
 *
 * `profiles.timezone` is deliberately NOT load-bearing here. It is available for
 * display, but scheduling off it would reintroduce exactly the browser-local
 * versus server-UTC mixing this avoids.
 */
/** Sentinel for "no reminder". A real offset is always a positive number. */
exports.REMINDER = { NONE: 0 };
/**
 * The offsets offered in the UI.
 *
 * Deliberately a short, plain list. Every entry is longer than the shortest
 * realistic deadline someone might set, so there is no "reminder for a reminder"
 * option that would fire almost immediately.
 */
exports.REMINDER_OPTIONS = [
    { value: exports.REMINDER.NONE, label: "No reminder" },
    { value: 10, label: "10 minutes before" },
    { value: 30, label: "30 minutes before" },
    { value: 60, label: "1 hour before" },
    { value: 1440, label: "1 day before" }
];
/** `"30 minutes before"` / `"1 hour before"` / `""` when there is no reminder. */
const formatReminderOffset = (minutes) => {
    if (!minutes || minutes <= 0)
        return "";
    const found = exports.REMINDER_OPTIONS.find((option) => option.value === minutes);
    if (found)
        return found.label;
    if (minutes < 60)
        return `${minutes} minutes before`;
    if (minutes < 1440) {
        const hours = minutes / 60;
        return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hour${hours === 1 ? "" : "s"} before`;
    }
    const days = Math.round(minutes / 1440);
    return `${days} day${days === 1 ? "" : "s"} before`;
};
exports.formatReminderOffset = formatReminderOffset;
/**
 * The instant a reminder fires, derived from the deadline and the offset.
 *
 * Returns null when there is no deadline or no offset, and when the reminder
 * would fall in the past - a reminder for a moment that has already gone is not
 * something to schedule.
 */
const reminderDueAt = (dueAt, offsetMinutes) => {
    if (!dueAt || !offsetMinutes || offsetMinutes <= 0)
        return null;
    const due = new Date(dueAt).getTime();
    if (Number.isNaN(due))
        return null;
    return new Date(due - offsetMinutes * 60000).toISOString();
};
exports.reminderDueAt = reminderDueAt;
/**
 * Is a reminder due right now?
 *
 * True once the derived fire time has passed and the task has not been notified
 * since it was last edited. Completed tasks and tasks without a deadline can
 * never be due.
 */
const isReminderDue = (input) => {
    const now = input.now ?? Date.now();
    if (input.completed)
        return false;
    const fire = (0, exports.reminderDueAt)(input.dueAt, input.offsetMinutes);
    if (!fire)
        return false;
    if (new Date(fire).getTime() > now)
        return false;
    // An edit bumps updated_at past sent_at, which re-arms the reminder. This is
    // what makes "change the deadline -> the new reminder is scheduled again"
    // work with no extra bookkeeping anywhere.
    if (input.sentAt && input.updatedAt) {
        return new Date(input.sentAt).getTime() < new Date(input.updatedAt).getTime();
    }
    return !input.sentAt;
};
exports.isReminderDue = isReminderDue;
const REMINDER_COLUMNS = "id, workspace_id, created_by, title, due_at, status, reminder_offset_minutes, reminder_sent_at, updated_at";
/**
 * Sets (or clears) a task's reminder.
 *
 * Clearing also clears `reminder_sent_at`, so turning a reminder off and on again
 * produces a genuinely new reminder rather than being suppressed by a stale
 * delivery record.
 */
const setTaskReminder = async (workspaceId, taskId, offsetMinutes) => {
    const patch = offsetMinutes === null || offsetMinutes <= 0
        ? { reminder_offset_minutes: null, reminder_sent_at: null }
        : { reminder_offset_minutes: offsetMinutes, reminder_sent_at: null };
    const { error } = await (0, client_1.db)()
        .from("tasks")
        .update(patch)
        .eq("workspace_id", workspaceId)
        .eq("id", taskId);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not update the reminder.");
};
exports.setTaskReminder = setTaskReminder;
/**
 * Reminders that are due now, for one user's workspace.
 *
 * The filter is applied in SQL so only candidate rows cross the wire, and the
 * `not.is.null` on `reminder_offset_minutes` is what keeps this cheap: the
 * partial index `tasks_reminder_pending_idx` covers exactly this predicate.
 */
const listDueReminders = async (workspaceId, options = {}) => {
    const now = options.now ?? Date.now();
    const query = (0, client_1.db)()
        .from("tasks")
        .select(REMINDER_COLUMNS)
        .eq("workspace_id", workspaceId)
        .neq("status", "done")
        .not("due_at", "is", null)
        .not("reminder_offset_minutes", "is", null)
        .lte("due_at", new Date(now + 7 * 86400000).toISOString()); // any offset up to a week
    if (options.userId)
        query.eq("created_by", options.userId);
    const { data, error } = await query;
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not load your reminders.");
    // The derived fire time and the "is it actually due" test are applied here
    // rather than in SQL because they depend on the offset arithmetic that the
    // view already documents. Only a small candidate set reaches this point.
    return (data ?? []).filter((row) => (0, exports.isReminderDue)({
        dueAt: row.due_at,
        offsetMinutes: row.reminder_offset_minutes,
        completed: row.status === "done",
        sentAt: row.reminder_sent_at,
        updatedAt: row.updated_at,
        now
    }));
};
exports.listDueReminders = listDueReminders;
/** Reminders that are due and not yet delivered. Used by the in-app panel. */
const listPendingReminders = async (workspaceId, options = {}) => (0, exports.listDueReminders)(workspaceId, options);
exports.listPendingReminders = listPendingReminders;
/**
 * Records that a reminder was delivered.
 *
 * The `lt(updated_at)` guard makes this a compare-and-set: if the task was
 * edited while the notification was in flight, the timestamp does not move and
 * the reminder stays armed. That is what stops an edit racing a delivery from
 * silently swallowing the new reminder.
 */
const markReminderSent = async (workspaceId, taskId, sentAt) => {
    const { error } = await (0, client_1.db)()
        .from("tasks")
        .update({ reminder_sent_at: sentAt })
        .eq("workspace_id", workspaceId)
        .eq("id", taskId)
        .lt("updated_at", sentAt);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not record the reminder.");
};
exports.markReminderSent = markReminderSent;
