import { useCallback, useEffect, useRef, useState } from "react";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  toReminderNotification,
  type ReminderNotification
} from "@/lib/data/notifications";
import { toDataError, type DataError } from "@/lib/data/errors";
import type { TaskNotificationRow } from "@/lib/data/types";

/**
 * The in-app reminder inbox.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE POLL FROM THE DASHBOARD
 * ---------------------------------------------------------------------------
 * Reminders arrive on the SERVER's schedule, not on the browser's. This poll
 * exists only to notice rows the dispatcher has already written; it never
 * decides that something is due. That separation is the whole point - it means
 * closing the tab loses nothing, because the notification was created while the
 * tab was closed.
 *
 * The interval is a compromise between freshness and cost. A reminder that is
 * only noticed seven minutes after it fired is still delivered correctly by
 * email; this poll only affects how quickly it appears on screen, so a modest
 * interval is proportionate.
 *
 * ---------------------------------------------------------------------------
 * WHY ACKNOWLEDGING IS OPTIMISTIC
 * ---------------------------------------------------------------------------
 * The row is removed from the screen immediately and restored if the write fails.
 * Waiting for a round trip to hide a notification the user has already dealt with
 * makes the button feel broken on a slow connection. The rollback is exact
 * because the notification is kept until the write resolves.
 */
export type NotificationsState = {
  notifications: ReminderNotification[];
  isLoading: boolean;
  error: DataError | null;
  /** Acknowledge one. Never touches the email side of a reminder. */
  dismiss: (notificationId: string) => Promise<void>;
  /** Acknowledge everything currently shown. */
  dismissAll: () => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
};

/** How often to notice rows the dispatcher has written. */
const POLL_MS = 60_000;

export function useNotifications(enabled: boolean): NotificationsState {
  const [rows, setRows] = useState<TaskNotificationRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<DataError | null>(null);

  // Survives unmount so a poll that resolves after the page has gone does not
  // try to set state on a dead component.
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await listNotifications();
      if (!mounted.current) return;
      setRows(next);
      setError(null);
    } catch (caught) {
      // A failed poll keeps whatever is already on screen. Notifications are
      // persistent now, so a transient failure loses nothing - it only delays
      // visibility - and blanking the list on a network blip would be worse than
      // showing slightly stale content.
      if (mounted.current) setError(toDataError(caught, "Could not load your reminders."));
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    void refresh();
    const timer = setInterval(() => {
      // Hidden tabs do no useful work, and polling competes with whatever the
      // user is actually doing. The rows persist regardless, so the next visible
      // poll picks up anything that arrived meanwhile.
      if (typeof document !== "undefined" && document.hidden) return;
      void refresh();
    }, POLL_MS);

    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [enabled, refresh]);

  const dismiss = useCallback(async (notificationId: string) => {
    const previous = rows;
    setRows((current) => current.filter((row) => row.id !== notificationId));
    try {
      await markNotificationRead(notificationId);
    } catch (caught) {
      // Put it back, so a failed acknowledgement never hides a real reminder.
      if (mounted.current) {
        setRows(previous);
        setError(toDataError(caught, "Could not dismiss that reminder."));
      }
    }
  }, [rows]);

  const dismissAll = useCallback(async () => {
    const previous = rows;
    setRows([]);
    try {
      await markAllNotificationsRead();
    } catch (caught) {
      if (mounted.current) {
        setRows(previous);
        setError(toDataError(caught, "Could not dismiss your reminders."));
      }
    }
  }, [rows]);

  return {
    notifications: rows.map(toReminderNotification),
    isLoading,
    error,
    dismiss,
    dismissAll,
    refresh,
    clearError: () => setError(null)
  };
}
