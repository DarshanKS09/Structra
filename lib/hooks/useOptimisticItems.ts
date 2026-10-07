"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ListItem } from "@/types/taskTypes";
import { toDataError, type DataError } from "@/lib/data/errors";

/**
 * Optimistic updates layered over a Supabase-derived list.
 *
 * ---------------------------------------------------------------------------
 * WHY AN OVERLAY AND NOT IN-PLACE MUTATION
 * ---------------------------------------------------------------------------
 * The simplest optimistic approach mutates the rendered array and restores a
 * snapshot if the write fails. That breaks as soon as two mutations overlap: the
 * second one's snapshot already contains the first one's unconfirmed change, so
 * rolling the second one back also discards the first - or worse, a slow failure
 * resurrects a deleted row.
 *
 * Instead the server list is treated as immutable truth, and pending intent is
 * held separately:
 *
 *   base            rows as last fetched from Supabase - never mutated
 *   pendingCreates  items shown before the row exists, keyed by a temp id
 *   pendingUpdates  edits/toggles shown before confirmation, keyed by real id
 *   pendingDeletes  ids hidden immediately
 *
 * `visible` is derived from base + overlay. Rollback is therefore exact and
 * trivially correct: drop the overlay entry and the base row reappears,
 * untouched. Concurrent mutations cannot corrupt each other because each owns
 * only its own overlay entry.
 *
 * ---------------------------------------------------------------------------
 * SOURCE OF TRUTH
 * ---------------------------------------------------------------------------
 * The overlay is ephemeral. It is never persisted, never written to
 * localStorage, and is discarded on unmount. On mount, on filter/mode change
 * and on any refetch the base list comes straight from Supabase, so a refresh,
 * a restart or a new login always renders database state.
 */

export type OptimisticState = {
  creates: Record<string, ListItem>;
  updates: Record<string, ListItem>;
  deletes: string[];
};

const EMPTY: OptimisticState = { creates: {}, updates: {}, deletes: [] };

/** Temp id for an item that has no server id yet. */
export const optimisticId = (): string =>
  `optimistic-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;

export const isOptimisticId = (id: string): boolean => id.startsWith("optimistic-");

export type OptimisticResult = { ok: true } | { ok: false; error: DataError };

/** Exactly what a single mutation changes. */
export type OptimisticIntent = {
  /** New rows, keyed by their temporary id. */
  creates?: ListItem[];
  /** Edited rows, keyed by their real id. */
  updates?: ListItem[];
  /** Ids to hide immediately. */
  deletes?: string[];
};

export type UseOptimisticItemsOptions = {
  /** Last known list from Supabase. Treated as immutable. */
  base: ListItem[];
  /** Applies the active filter/search, so optimistic rows match the server view. */
  isVisible: (item: ListItem) => boolean;
  /** Called after a confirmed write so the base list can be reconciled. */
  onCommitted?: () => void;
};

export type UseOptimisticItemsResult = {
  /** base + overlay, filtered. This is what the UI renders. */
  visible: ListItem[];
  /** True while at least one write is in flight. */
  pending: boolean;
  error: DataError | null;
  clearError: () => void;

  /**
   * Runs a mutation with an optimistic update.
   *
   * `intent` must state explicitly which rows this operation creates, updates
   * and deletes. Inferring it by diffing against the current list is unsafe: two
   * overlapping single-item deletes would each conclude that every row is being
   * removed, hiding rows the other operation never touched. Declaring intent
   * makes concurrent operations independent, since each owns only its own ids.
   *
   * @param intent      rows this operation creates / updates / deletes
   * @param commit      the Supabase operation
   * @param reconcile   folds the confirmed server row into the base list
   * @param onSuccess   runs after the base list has been updated
   */
  run: <T>(
    intent: OptimisticIntent,
    commit: () => Promise<T>,
    reconcile: (saved: T) => void,
    onSuccess?: () => void
  ) => Promise<OptimisticResult>;
};

export function useOptimisticItems({
  base,
  isVisible,
  onCommitted
}: UseOptimisticItemsOptions): UseOptimisticItemsResult {
  const [state, setState] = useState<OptimisticState>(EMPTY);
  const [inFlight, setInFlight] = useState(0);
  const [error, setError] = useState<DataError | null>(null);

  // Refs let `run` stay stable while always reading current values.
  const baseRef = useRef(base);
  baseRef.current = base;
  const isVisibleRef = useRef(isVisible);
  isVisibleRef.current = isVisible;
  const committedRef = useRef(onCommitted);
  committedRef.current = onCommitted;

  const patch = useCallback((fn: (previous: OptimisticState) => OptimisticState) => {
    setState((previous) => fn(previous));
  }, []);

  const visible = useMemo(() => {
    const deleted = new Set(state.deletes);
    const rows: ListItem[] = [];

    for (const item of base) {
      if (deleted.has(item.id)) continue;
      const override = state.updates[item.id];
      const effective = override ?? item;
      if (isVisibleRef.current(effective)) rows.push(effective);
    }

    // Pending creates appear first, mirroring newest-first ordering.
    for (const item of Object.values(state.creates)) {
      if (isVisibleRef.current(item)) rows.unshift(item);
    }

    return rows;
  }, [base, state]);

  const run = useCallback(
    async <T,>(
      intent: OptimisticIntent,
      commit: () => Promise<T>,
      reconcile: (saved: T) => void,
      onSuccess?: () => void
    ): Promise<OptimisticResult> => {
      // Only the ids this operation declared, so overlapping mutations stay
      // independent.
      const createdIds = (intent.creates ?? []).map((item) => item.id);
      const updatedIds = (intent.updates ?? []).map((item) => item.id);
      const deletedIds = intent.deletes ?? [];

      // 1. Show the optimistic state immediately.
      patch((previous) => ({
        creates: {
          ...previous.creates,
          ...Object.fromEntries((intent.creates ?? []).map((i) => [i.id, i]))
        },
        updates: {
          ...previous.updates,
          ...Object.fromEntries((intent.updates ?? []).map((i) => [i.id, i]))
        },
        deletes: [...new Set([...previous.deletes, ...deletedIds])]
      }));

      setInFlight((n) => n + 1);
      setError(null);

      try {
        // 2. Perform the Supabase operation in the background.
        const saved = await commit();

        // 3. Drop the overlay, then fold the confirmed row into the base list.
        patch((previous) => {
          const creates = { ...previous.creates };
          const updates = { ...previous.updates };
          for (const id of createdIds) delete creates[id];
          for (const id of updatedIds) delete updates[id];
          return {
            creates,
            updates,
            deletes: previous.deletes.filter((id) => !deletedIds.includes(id))
          };
        });

        reconcile(saved);
        committedRef.current?.();
        onSuccess?.();
        return { ok: true };
      } catch (caught) {
        const normalised = toDataError(caught);

        // 4. Roll back exactly the entries this operation owned.
        patch((previous) => {
          const creates = { ...previous.creates };
          const updates = { ...previous.updates };
          for (const id of createdIds) delete creates[id];
          for (const id of updatedIds) delete updates[id];
          return {
            creates,
            updates,
            deletes: previous.deletes.filter((id) => !deletedIds.includes(id))
          };
        });

        setError(normalised);
        return { ok: false, error: normalised };
      } finally {
        setInFlight((n) => Math.max(0, n - 1));
      }
    },
    [patch]
  );

  const clearError = useCallback(() => setError(null), []);

  return { visible, pending: inFlight > 0, error, clearError, run };
}