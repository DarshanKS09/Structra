"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toDataError, type DataError } from "@/lib/data/errors";
import type { AsyncStatus } from "@/lib/data/types";

/**
 * A minimal async data hook with explicit loading / success / empty / error
 * states.
 *
 * Two behaviours matter for correctness here:
 *
 *  1. A response for a stale request is discarded. Typing in a search box
 *     starts several requests in quick succession and they can complete out of
 *     order; without this guard an older, slower response can overwrite a newer
 *     one and the list flickers to the wrong data.
 *
 *  2. `error` is never replaced by an empty array. A rejected request (RLS,
 *     network, expired session) must stay visible as an error, otherwise it is
 *     indistinguishable from "you have no data yet".
 */
export type AsyncState<T> = {
  status: AsyncStatus;
  data: T | null;
  error: DataError | null;
  /** True only for the very first load, not for subsequent refreshes. */
  isInitialLoading: boolean;
  isRefreshing: boolean;
};

export type UseAsyncDataResult<T> = AsyncState<T> & {
  reload: () => Promise<void>;
  /** Applies a local update without a round trip, for optimistic writes. */
  setData: (updater: T | ((previous: T | null) => T | null)) => void;
};

export function useAsyncData<T>(
  loader: () => Promise<T>,
  deps: React.DependencyList,
  options: { enabled?: boolean } = {}
): UseAsyncDataResult<T> {
  const { enabled = true } = options;

  const [state, setState] = useState<AsyncState<T>>({
    status: "idle",
    data: null,
    error: null,
    isInitialLoading: enabled,
    isRefreshing: false
  });

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Monotonic request id: only the newest request may write state.
  const requestId = useRef(0);

  /**
   * The loader is held in a ref, refreshed on every render.
   *
   * This is the whole point of the hook and the source of a serious bug when it
   * is missing. `run` is memoised on `[enabled]` alone, so without this ref it
   * would permanently capture whichever `loader` existed when `enabled` last
   * changed. Every later call - a mode switch, a filter change, a refetch after a
   * mutation - would then execute that stale closure and silently re-apply the
   * old mode, filter and search.
   *
   * The symptom was a task counter that increased while the list stayed empty:
   * the counter came from a separate, always-current query, while the list was
   * refetched through a frozen loader still filtering on the previous filter.
   */
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const run = useCallback(async () => {
    if (!enabled) {
      setState({ status: "idle", data: null, error: null, isInitialLoading: false, isRefreshing: false });
      return;
    }

    const id = ++requestId.current;
    setState((previous) => ({
      ...previous,
      status: previous.data === null ? "loading" : previous.status,
      error: null,
      isInitialLoading: previous.data === null,
      isRefreshing: previous.data !== null
    }));

    try {
      // Always the current loader, never a captured one.
      const value = await loaderRef.current();
      if (!mounted.current || id !== requestId.current) return;
      setState({
        status: "success",
        data: value,
        error: null,
        isInitialLoading: false,
        isRefreshing: false
      });
    } catch (caught) {
      if (!mounted.current || id !== requestId.current) return;
      setState((previous) => ({
        status: "error",
        // Preserve the previous data so the UI can keep showing it alongside an
        // error banner instead of blanking out.
        data: previous.data,
        error: toDataError(caught),
        isInitialLoading: false,
        isRefreshing: false
      }));
    }
    // `loader` is intentionally NOT a dependency: callers pass an inline
    // function, so including it would re-run on every render. The ref above
    // keeps `run` reading the current loader without making it unstable.
  }, [enabled]);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const setData = useCallback((updater: T | ((previous: T | null) => T | null)) => {
    setState((previous) => {
      const next = typeof updater === "function" ? (updater as (p: T | null) => T | null)(previous.data) : updater;
      return { ...previous, data: next, status: "success", error: null };
    });
  }, []);

  return { ...state, reload: run, setData };
}

/**
 * Wraps a mutation (create/update/delete) with pending state and error capture.
 *
 * Mutations never update state on failure: a failed write leaves the list as it
 * was, which is the only honest representation when the database rejected it.
 */
export function useMutation<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>
) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DataError | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const mutate = useCallback(
    async (...args: TArgs): Promise<{ ok: true; value: TResult } | { ok: false; error: DataError }> => {
      setPending(true);
      setError(null);
      try {
        const value = await action(...args);
        return { ok: true, value };
      } catch (caught) {
        const normalised = toDataError(caught);
        if (mounted.current) setError(normalised);
        return { ok: false, error: normalised };
      } finally {
        if (mounted.current) setPending(false);
      }
    },
    [action]
  );

  const clearError = useCallback(() => setError(null), []);

  return { mutate, pending, error, clearError };
}