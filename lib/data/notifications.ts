import { db } from "@/lib/data/client";
import { toDataError } from "@/lib/data/errors";
import type { TaskNotificationRow } from "@/lib/data/types";

/**
 * In-app reminder notifications.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE ARE ROWS AND NOT A DERIVED LIST
 * ---------------------------------------------------------------------------
 * The previous implementation showed reminders by querying `tasks` for rows whose
 * fire time had passed. That is a view, not a notification, and it had two
 * consequences:
 *
 *   1. IT ONLY EXISTED WHILE A TAB WAS OPEN AND POLLING. With Structra closed,
 *      nothing was shown on return, because the query that would have produced
 *      the list had never run. A reminder that is stored but not visible is not
 *      a reminder.
 *
 *   2. ACKNOWLEDGING IT DESTROYED THE EMAIL. The "Dismiss" button wrote
 *      `tasks.reminder_sent_at` - the same column the email sweep uses to decide
 *      what has already gone out. Simply looking at a reminder and closing it
 *      therefore suppressed that task's email permanently.
 *
 * Both are structural problems with deriving the UI from the task table, so both
 * are fixed by writing real rows: the dispatcher creates one, the client reads
 * them, and acknowledging touches only `read_at` on the row it read.
 *
 * ---------------------------------------------------------------------------
 * OWNERSHIP
 * ---------------------------------------------------------------------------
 * Every query is scoped by the AUTHENTICATED USER, taken from the session rather
 * than from a parameter, so a caller cannot ask for someone else's
 * notifications even by passing their id. RLS enforces the same thing in the
 * database (`user_id = auth.uid()`), so this filter is the first of two
 * independent defences rather than the only one.
 *
 * There is no `create` function here on purpose: notifications are written by the
 * server-side dispatcher with the service role. Allowing a client to insert its
 * own would let it fabricate reminders.
 */

/** Unread notifications for the signed-in user, newest first. */
export const listNotifications = async (
  limit = 25
): Promise<TaskNotificationRow[]> => {
  const user = await currentUserId();

  const { data, error } = await db()
    .from("task_notifications")
    .select("*")
    .eq("user_id", user)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw toDataError(error, "Could not load your reminders.");
  return data ?? [];
};

/**
 * Marks one notification read.
 *
 * Scoped by `user_id` as well as `id`, so even if the id were guessed this can
 * only ever acknowledge the caller's own notification.
 *
 * Deliberately touches NOTHING on `tasks`. Acknowledging is about the user's
 * attention, and has no bearing on whether an email was sent.
 */
export const markNotificationRead = async (notificationId: string): Promise<void> => {
  const user = await currentUserId();

  const { error } = await db()
    .from("task_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", user);

  if (error) throw toDataError(error, "Could not dismiss that reminder.");
};

/**
 * Marks every unread notification read.
 *
 * Used by "Dismiss all", and by nothing else. Returns the number affected so the
 * caller can tell the difference between "cleared three" and "there was
 * nothing".
 */
export const markAllNotificationsRead = async (): Promise<number> => {
  const user = await currentUserId();

  const { data, error } = await db()
    .from("task_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user)
    .is("read_at", null)
    .select("id");

  if (error) throw toDataError(error, "Could not dismiss your reminders.");
  return data?.length ?? 0;
};

/**
 * The signed-in user's id, read from the session on every call.
 *
 * Read per call rather than cached in a module variable so a sign-out cannot
 * leave a stale identity behind, and so nothing has to be invalidated when the
 * session changes.
 */
const currentUserId = async (): Promise<string> => {
  const { data, error } = await db().auth.getUser();
  if (error) throw toDataError(error, "Could not read the current session.");
  const id = data.user?.id;
  if (!id) {
    throw toDataError({ message: "No authenticated user" }, "You must be signed in.");
  }
  return id;
};

/**
 * A notification, shaped for display.
 *
 * `body` and `due_at` are COPIES taken when the reminder fired, not joins back
 * to the task. That is intentional: the notification has to keep rendering the
 * truth as it was when raised, and it must not disappear or change because the
 * task was later edited or deleted.
 */
export type ReminderNotification = {
  id: string;
  taskId: string;
  title: string;
  body: string | null;
  offsetMinutes: number | null;
  dueAt: string | null;
  createdAt: string;
};

export const toReminderNotification = (row: TaskNotificationRow): ReminderNotification => ({
  id: row.id,
  taskId: row.task_id,
  title: row.title,
  body: row.body,
  offsetMinutes: row.offset_minutes,
  dueAt: row.due_at,
  createdAt: row.created_at
});
