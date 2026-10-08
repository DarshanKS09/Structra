"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { loadDashboardSnapshot, type DashboardSection } from "@/lib/dashboard/aggregate";
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

  // `now` is a dependency so "overdue" and "due today" stay correct if the tab
  // stays open across midnight, without the user having to reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

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
    [sections, load]
  );

  return {
    sections: views,
    priority,
    actionable,
    totals,
    status,
    error,
    isInitialLoading: status === "loading" && sections.length === 0,
    reload: load,
    complete
  };
}

/** True when an item is currently finished, for the checkbox state. */
export const isDone = (item: ListItem): boolean => isItemCompleted(item);