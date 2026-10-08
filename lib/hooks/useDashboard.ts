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
import { listDueReminders, markReminderSent, type ReminderRow } from "@/lib/data/reminders";
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
  /** Reminders that are due and not yet delivered. */
  dueReminders: ReminderRow[];
  /** How many finished grocery trips exist. */
  groceryHistoryCount: number;
  /** Acknowledges (hides) a delivered reminder. */
  dismissReminder: (taskId: string) => Promise<void>;
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
  const [dueReminders, setDueReminders] = useState<ReminderRow[]>([]);
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
      setDueReminders(snapshot.dueReminders);
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

  // Why reminders need their own poll, on top of the clock above.
  //
  // `now` only recomputes labels on rows already in memory. A reminder whose
  // fire instant passes while the tab sits open would therefore never surface
  // until a manual reload - the reminder would be "stored persistently" and yet
  // still not be delivered in-app.
  //
  // The re-read is deliberately narrow: one indexed query for THIS user's due
  // reminders, not a second full dashboard snapshot. It is also skipped when
  // there is nothing to do, and when the document is hidden, because a reminder
  // arriving in a background tab is still shown the moment the user returns.
  useEffect(() => {
    if (!workspaceId || !userId) return;

    let cancelled = false;

    const poll = async () => {
      // Hidden tabs do no useful work; this also stops the interval from
      // competing with the tab the user is actually looking at.
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const rows = await listDueReminders(workspaceId, { userId });
        if (!cancelled) setDueReminders(rows);
      } catch {
        // A failed poll must never surface as an error: the last known list
        // stays on screen and the next tick tries again. Reminders are
        // advisory, so a transient network blip should not disturb the page.
      }
    };

    const timer = setInterval(() => void poll(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [workspaceId, userId]);

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

  /**
   * Acknowledges a reminder.
   *
   * Writes `reminder_sent_at` so the reminder stops appearing - and, critically,
   * stops being emailed by the scheduled sweep. Until this lands the row would
   * keep reappearing on every Dashboard load, which is exactly the "duplicate
   * reminders" failure.
   */
  const dismissReminder = useCallback(
    async (taskId: string) => {
      if (!workspaceId) return;
      // Removed immediately: the user has already acted, so waiting for the
      // write would leave a dismissed item on screen.
      setDueReminders((current) => current.filter((row) => row.id !== taskId));
      try {
        await markReminderSent(workspaceId, taskId, new Date().toISOString());
      } catch (caught) {
        // Restore it so the user is not left believing it is dismissed when the
        // database disagrees.
        const snapshot = await loadDashboardSnapshot(workspaceId, userId ?? "").catch(
          () => null
        );
        if (snapshot && mounted.current) setDueReminders(snapshot.dueReminders);
        setError(toDataError(caught, "Could not dismiss that reminder."));
      }
    },
    [workspaceId, userId]
  );

  return {
    sections: views,
    priority,
    actionable,
    totals,
    taskAnalytics,
    studyAnalytics,
    dueReminders,
    groceryHistoryCount,
    dismissReminder,
    status,
    error,
    isInitialLoading: status === "loading" && sections.length === 0,
    reload: load,
    complete
  };
}

/** True when an item is currently finished, for the checkbox state. */
export const isDone = (item: ListItem): boolean => isItemCompleted(item);