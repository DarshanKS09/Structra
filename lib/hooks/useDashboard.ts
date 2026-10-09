"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  loadDashboardSnapshot,
  type DashboardSection
} from "@/lib/dashboard/aggregate";
import {
  toDashboardItem,
  splitByPriority,
  countOverdue,
  countDueToday,
  type DashboardItem,
  type PrioritisedGroup
} from "@/lib/dashboard/prioritize";
import { isItemCompleted } from "@/lib/data/adapters";
import { toDataError, DataError, type DataErrorCode } from "@/lib/data/errors";
import type { AsyncStatus } from "@/lib/data/types";
import type { TaskAnalytics } from "@/lib/data/analytics";
import type { StudyAnalytics } from "@/lib/data/studyAnalytics";
import { useTaskStore } from "@/store/useTaskStore";
import type { ListItem, ListMode } from "@/types/taskTypes";

/**
 * Dashboard state.
 *
 * ---------------------------------------------------------------------------
 * SOURCE OF TRUTH
 * ---------------------------------------------------------------------------
 * Every persistent value here comes from `loadDashboardSnapshot`, which reads
 * Supabase through the existing data layer. Nothing is restored from localStorage
 * or from a previous optimistic state, so a refresh or a reopen rebuilds the
 * Dashboard from the database.
 *
 * ---------------------------------------------------------------------------
 * OPTIMISTISM
 * ---------------------------------------------------------------------------
 * Completing an item applies the change locally first so the Dashboard reacts
 * instantly, then performs the write through `useModeItems`' mutation layer. If
 * the write fails the optimistic change is rolled back and the error surfaced,
 * so the Dashboard can never show an item as done that the database disagrees
 * with.
 */

export type DashboardSectionView = DashboardSection & {
  /** Pending items converted for ranking. */
  pending: DashboardItem[];
  /** Wishlist entries, ranked but never merged into the priority list. */
  wishlist: DashboardItem[];
};

export type DashboardState = {
  sections: DashboardSectionView[];
  priority: PrioritisedGroup;
  /** The flat actionable list the "Do first" / "Up next" areas render. */
  actionable: DashboardItem[];
  totals: {
    overdue: number;
    dueToday: number;
    pending: number;
    completed: number;
    wishlist: number;
  };
  status: AsyncStatus;
  error: DataError | null;
  isInitialLoading: boolean;
  /** Headline task metrics for the Task Progress card. */
  taskAnalytics: TaskAnalytics | null;
  /** Study readout for the Study card. */
  studyAnalytics: StudyAnalytics | null;
  /**
   * How many finished grocery trips exist.
   *
   * Reminders are NOT here: they are persistent notification rows read by
   * `useNotifications`, so they can exist without a Dashboard snapshot and
   * without a browser tab open.
   */
  groceryHistoryCount: number;
  reload: () => Promise<void>;
  /**
   * Marks an item done: applied locally, then committed through `write`.
   *
   * `write` is supplied by the caller so the Dashboard reuses the existing
   * per-mode write path rather than introducing a second one.
   */
  complete: (
    mode: ListMode,
    id: string,
    write: () => Promise<{ ok: boolean }>
  ) => Promise<boolean>;
};

export function useDashboard(): DashboardState {
  const { workspace, user } = useAuth();
  const workspaceId = workspace?.id ?? null;
  const userId = user?.id ?? null;
  const enabled = Boolean(workspaceId && userId);

  const [sections, setSections] = useState<DashboardSection[]>([]);
  const [status, setStatus] = useState<AsyncStatus>("idle");
  const [error, setError] = useState<DataError | null>(null);
  const [pendingWrites, setPendingWrites] = useState(0);
  const [taskAnalytics, setTaskAnalytics] = useState<TaskAnalytics | null>(null);
  const [studyAnalytics, setStudyAnalytics] = useState<StudyAnalytics | null>(null);
  const [groceryHistoryCount, setGroceryHistoryCount] = useState(0);

  // Shared task-change signal. Announced on confirmed writes so the Task Centre and
  // the analytics pages re-read without a manual refresh.
  const bumpTaskRevision = useTaskStore((state) => state.bumpTaskRevision);
  const taskRevision = useTaskStore((state) => state.taskRevision);
  // Set to the revision value this hook is about to create, so the effect above
  // can tell "someone else changed tasks" from "I changed them".
  const ownRevision = useRef<number | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!workspaceId || !userId) return;
    // The previous sections are deliberately NOT cleared here. `isInitialLoading`
    // is derived from `sections.length === 0`, so a reload after completing an
    // item re-reads from the database without collapsing the Dashboard back to
    // a skeleton in between.
    setStatus("loading");
    try {
      const snapshot = await loadDashboardSnapshot(workspaceId, userId);
      if (!mounted.current) return;
      setSections(snapshot.sections);
      setTaskAnalytics(snapshot.taskAnalytics);
      setStudyAnalytics(snapshot.studyAnalytics);
      setGroceryHistoryCount(snapshot.groceryHistoryCount);
      setError(
        snapshot.partial
          ? new DataError(
              "DATABASE",
              `Some sections could not be loaded: ${snapshot.failed.join(", ")}.`
            )
          : null
      );
      setStatus("success");
    } catch (caught) {
      if (!mounted.current) return;
      setError(toDataError(caught, "Could not load your dashboard."));
      setStatus("error");
    }
  }, [workspaceId, userId]);

  useEffect(() => {
    if (!enabled) {
      setSections([]);
      setStatus("idle");
      return;
    }
    void load();
  }, [enabled, load]);

  /**
   * Re-read the Dashboard when a task is written somewhere else.
   *
   * Without this, completing a task in the Task Centre left the Dashboard's
   * snapshot stale, so the counts, priority bands and analytics cards showed the
   * state from before the write until the page was reloaded.
   *
   * `ownRevision` suppresses the echo of a write this hook itself made: `complete`
   * already re-reads directly after a successful write, and reacting to its own
   * signal as well would fetch the whole snapshot twice for one click.
   */
  useEffect(() => {
    if (!enabled) return;
    if (ownRevision.current === taskRevision) {
      ownRevision.current = null;
      return;
    }
    void load();
  }, [enabled, load, taskRevision]);

  // `now` is a dependency so "overdue" and "due today" stay correct if the tab
  // stays open across midnight, without the user having to reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

  /*
   * The reminder poll that used to live here is GONE, and its removal is the point.
   *
   * It queried `tasks` for rows whose fire time had passed. Two things were wrong
   * with that, and neither was fixable by polling harder:
   *
   *   1. It could only ever report reminders while a tab happened to be open. With
   *      Structra closed, nothing was recorded anywhere, so the reminder did not
   *      exist to be discovered later.
   *
   *   2. Its "Dismiss" wrote `tasks.reminder_sent_at` - the mail sweep's delivery
   *      record. Acknowledging an in-app reminder therefore suppressed its email.
   *
   * Delivery is now the server scheduler's job: it writes a
   * `task_notifications` row and sends the email. This hook only needs to notice
   * rows that already exist, which `useNotifications` does. The `now` clock above
   * still drives the "overdue"/"due today" labels and is unaffected.
   */

  const views = useMemo<DashboardSectionView[]>(
    () =>
      sections.map((section) => ({
        ...section,
        pending: section.buckets.pending.map((item) => toDashboardItem(item, now)),
        wishlist: section.buckets.wishlist.map((item) => toDashboardItem(item, now))
      })),
    [sections, now]
  );

  const actionable = useMemo(
    () => views.flatMap((section) => section.pending),
    [views]
  );

  const priority = useMemo(() => splitByPriority(actionable), [actionable]);

  const totals = useMemo(
    () => ({
      overdue: countOverdue(actionable),
      dueToday: countDueToday(actionable),
      pending: actionable.length,
      completed: sections.reduce((sum, section) => sum + section.buckets.completedCount, 0),
      wishlist: views.reduce((sum, section) => sum + section.wishlist.length, 0)
    }),
    [actionable, sections, views]
  );

  /**
   * Marks an item done, optimistically.
   *
   * The item is removed from the pending set immediately so it leaves "Do
   * first" without waiting for a round trip. The caller supplies the actual
   * write (from `useModeItems`, so there stays a single write path per mode);
   * on success the Dashboard is re-read from Supabase, and on failure the local
   * change is reverted so the item returns along with the error.
   *
   * Only the "done" direction is offered: completed items are summarised as a
   * count rather than listed, so the Dashboard has no control to un-complete
   * them and does not pretend to have one.
   */
  const complete = useCallback(
    async (
      mode: ListMode,
      id: string,
      write: () => Promise<{ ok: boolean }>
    ): Promise<boolean> => {
      const before = sections;
      setPendingWrites((n) => n + 1);

      setSections((current) =>
        current.map((section) => {
          if (section.mode !== mode) return section;
          if (!section.buckets.pending.some((row) => row.id === id)) return section;
          return {
            ...section,
            buckets: {
              pending: section.buckets.pending.filter((row) => row.id !== id),
              completedCount: section.buckets.completedCount + 1,
              wishlist: section.buckets.wishlist
            }
          };
        })
      );

      try {
        const result = await write();
        if (!result.ok) {
          if (mounted.current) setSections(before);
          return false;
        }
        // Tell the other task surfaces BEFORE re-reading, so the Task Centre and
        // the analytics pages start their own re-read in the same tick rather
        // than after this hook's own (much larger) snapshot load finishes.
        //
        // Only on a confirmed write: announcing a failed one would make those
        // views re-read and re-render state the database never accepted, which is
        // precisely the contradictory-state bug this is meant to remove.
        if (mode === "task" || mode === "study") {
          ownRevision.current = taskRevision + 1;
          bumpTaskRevision();
        }
        // Re-read so the summary counts and the priority order reflect what the
        // database now holds rather than the local guess.
        await load();
        return true;
      } catch (caught) {
        if (mounted.current) {
          setSections(before);
          setError(toDataError(caught, "Could not update that item."));
        }
        return false;
      } finally {
        if (mounted.current) setPendingWrites((n) => Math.max(0, n - 1));
      }
    },
    // `taskRevision` is read only to predict the value this write will produce,
    // so it is listed for correctness; `ownRevision` is a ref and needs no
    // dependency.
    [sections, load, bumpTaskRevision, taskRevision]
  );

  /*
   * Reminder acknowledgement was REMOVED from this hook, deliberately.
   *
   * It used to write `tasks.reminder_sent_at` on dismiss. That column is the
   * mail sweep's record of what has already gone out, so clicking "Dismiss" on
   * an in-app reminder permanently suppressed that task's email. The user
   * looking at a notification was cancelling a message they had not received.
   *
   * Acknowledging now lives in `useNotifications` and writes only
   * `task_notifications.read_at` - the user's attention, and nothing else. The
   * two concerns are separate columns on separate tables by design.
   */

  return {
    sections: views,
    priority,
    actionable,
    totals,
    taskAnalytics,
    studyAnalytics,
    groceryHistoryCount,
    status,
    error,
    isInitialLoading: status === "loading" && sections.length === 0,
    reload: load,
    complete
  };
}

/** True when an item is currently finished, for the checkbox state. */
export const isDone = (item: ListItem): boolean => isItemCompleted(item);
