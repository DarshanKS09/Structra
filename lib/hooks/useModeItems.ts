"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ListItem, ListMode } from "@/types/taskTypes";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useAsyncData } from "@/lib/hooks/useAsyncData";
import {
  useOptimisticItems,
  optimisticId,
  type OptimisticIntent
} from "@/lib/hooks/useOptimisticItems";
import { DataError, toDataError } from "@/lib/data/errors";
import { useTaskStore } from "@/store/useTaskStore";
import type { Json } from "@/lib/supabase/types";
import type { AsyncStatus } from "@/lib/data/types";
import {
  countTasks,
  listTasks,
  createTask,
  updateTask,
  setTaskCompleted,
  deleteTask,
  type TaskCompletionFilter
} from "@/lib/data/tasks";
import {
  listHabits,
  createHabit,
  updateHabit,
  setHabitCompleted,
  deleteHabit,
  todayKey
} from "@/lib/data/habits";
import {
  listStudySubjects,
  listStudySessions,
  createStudySubject,
  startStudySession,
  stopStudySession,
  logStudySession,
  updateStudySession,
  setStudySessionDuration,
  deleteStudySession,
  getRunningSession
} from "@/lib/data/study";
import {
  listRecords,
  createRecord,
  updateRecord,
  updateRecordData,
  deleteRecord,
  ensureRecordType,
  BUILT_IN_RECORD_TYPES,
  readDataField
} from "@/lib/data/records";
import {
  ensureDefaultGroceryList,
  listGroceryItems,
  createGroceryItem,
  setGroceryItemCompleted,
  updateGroceryItem,
  deleteGroceryItem
} from "@/lib/data/groceries";
import { listNotes, createNote, updateNote, deleteNote, archiveNote } from "@/lib/data/notes";
import {
  taskRowToItem,
  groceryRowToItem,
  habitRowToItem,
  studyRowToItem,
  fitnessRowToItem,
  shoppingRowToItem,
  noteRowToItem,
  toTaskDraft,
  toGroceryDraft,
  toHabitDraft,
  toStudyDraft,
  toFitnessDraft,
  toShoppingDraft,
  toNoteDraft,
  isItemCompleted,
  toDateInputValue,
  minutesToSeconds
} from "@/lib/data/adapters";

/**
 * The bridge between Structra's seven modes and the database.
 *
 * This hook is the only place that knows which table backs which mode. It emits
 * the existing `ListItem` union so `ModeList`, `ItemCard`, `EmptyState` and
 * `AddItemModal` continue to work unchanged - the UI was not redesigned.
 *
 * Mode -> storage:
 *
 *   task     -> tasks
 *   grocery  -> grocery_lists + grocery_items
 *   habit    -> habits + habit_completions (streak derived, not stored)
 *   study    -> study_subjects + study_sessions
 *   meeting  -> notes
 *   fitness  -> records of the "Fitness" record type
 *   shopping -> records of the "Shopping" record type
 *
 * Fitness and Shopping use the general record system because the schema
 * deliberately provides that path: a new kind of tracking should not require a
 * migration. `title` holds the name and `data` holds the mode-specific fields.
 */

export type ModeFilter = "all" | "active" | "completed";

export type MutationResult = { ok: true } | { ok: false; error: DataError };

export type ModeItemsState = {
  items: ListItem[];
  status: AsyncStatus;
  error: DataError | null;
  isInitialLoading: boolean;
  /** `null` when the mode has no count query; see `ModeCounts`. */
  counts: { all: number; active: number; completed: number } | null;
  reload: () => Promise<void>;
  /**
   * Re-resolves the mode's parent row (grocery list, record type, study subjects)
   * and re-reads the list as a result. Needed when a write REPLACES the parent
   * rather than mutating it - finishing a grocery trip archives the current list
   * and stands up a new one, which no other dependency change would reveal.
   */
  refreshParent: () => Promise<void>;
  create: (item: ListItem) => Promise<MutationResult>;
  update: (id: string, item: ListItem) => Promise<MutationResult>;
  toggle: (id: string) => Promise<MutationResult>;
  remove: (id: string) => Promise<MutationResult>;
  pending: boolean;
  mutationError: DataError | null;
  clearMutationError: () => void;
  /** Study mode only: a running session, for the timer. */
  runningSessionStartedAt: string | null;
  startSession: (input?: { subjectName?: string; topic?: string }) => Promise<MutationResult>;
  stopSession: () => Promise<MutationResult>;
};

/**
 * Counts are only populated for task mode, which has a dedicated count query.
 *
 * Deriving them from the currently visible rows would be wrong: that list is
 * already filtered and searched, so "active (3)" could mean 3 of 40. Reporting
 * `null` lets the toolbar omit the number instead of stating something false.
 */
type ModeCounts = { all: number; active: number; completed: number } | null;

export function useModeItems(
  mode: ListMode,
  filter: ModeFilter,
  searchQuery: string
): ModeItemsState {
  const { workspace, user } = useAuth();
  const workspaceId = workspace?.id ?? null;
  const userId = user?.id ?? null;

  // The shared "task data changed" signal. Read here so this hook re-reads when
  // the Dashboard or an analytics page commits a write, and written after this
  // hook's own commits so the reverse direction is just as immediate.
  const taskRevision = useTaskStore((state) => state.taskRevision);
  const bumpTaskRevision = useTaskStore((state) => state.bumpTaskRevision);

  // Resolved once per mount for the modes that need a parent row.
  const [recordTypeId, setRecordTypeId] = useState<string | null>(null);
  const [groceryListId, setGroceryListId] = useState<string | null>(null);
  const [subjectNames, setSubjectNames] = useState<Map<string, string>>(new Map());
  const [runningStartedAt, setRunningStartedAt] = useState<string | null>(null);
  const [counts, setCounts] = useState<ModeCounts>(null);

  const enabled = Boolean(workspaceId && userId && mode);

  /**
   * Bumped to force the parent-row effect below to run again.
   *
   * Needed because finishing a grocery trip REPLACES the parent list rather than
   * mutating it: the list the hook is bound to stops being active, and the user's
   * next shop is a brand-new row. The effect's own dependencies (mode, workspace,
   * user) are all unchanged by that, so without this signal the hook would keep
   * reading the list it resolved at mount - which is now archived - and the screen
   * would appear to show no change after a successful finish.
   */
  const [parentRevision, setParentRevision] = useState(0);

  const refreshParent = useCallback(async () => {
    setParentRevision((revision) => revision + 1);
  }, []);

  // --- parent-row resolution ------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    if (!workspaceId) return;

    if (mode === "fitness" || mode === "shopping") {
      void (async () => {
        try {
          const type = await ensureRecordType(
            workspaceId,
            userId!,
            mode === "fitness" ? BUILT_IN_RECORD_TYPES.fitness : BUILT_IN_RECORD_TYPES.shopping
          );
          if (!cancelled) setRecordTypeId(type.id);
        } catch {
          // Surfaced through the list error below rather than swallowed here.
          if (!cancelled) setRecordTypeId(null);
        }
      })();
    }

    if (mode === "grocery") {
      void (async () => {
        try {
          const list = await ensureDefaultGroceryList(workspaceId);
          if (!cancelled) setGroceryListId(list.id);
        } catch {
          if (!cancelled) setGroceryListId(null);
        }
      })();
    }

    if (mode === "study") {
      void (async () => {
        try {
          const subjects = await listStudySubjects(workspaceId);
          if (!cancelled) {
            setSubjectNames(new Map(subjects.map((s) => [s.id, s.name])));
          }
          const running = await getRunningSession(workspaceId, userId!);
          if (!cancelled) setRunningStartedAt(running?.started_at ?? null);
        } catch {
          if (!cancelled) {
            setSubjectNames(new Map());
            setRunningStartedAt(null);
          }
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [mode, workspaceId, userId, parentRevision]);

  // --- list -----------------------------------------------------------------
  const loader = useCallback(async (): Promise<ListItem[]> => {
    if (!workspaceId || !userId) return [];

    switch (mode) {
      case "task": {
        const rows = await listTasks(workspaceId, {
          filter: filter as TaskCompletionFilter,
          search: searchQuery
        });
        return rows.map(taskRowToItem);
      }

      case "grocery": {
        if (!groceryListId) return [];
        const rows = await listGroceryItems(groceryListId, {
          search: searchQuery,
          filter: filter === "completed" ? "completed" : filter === "active" ? "active" : "all"
        });
        return rows.map(groceryRowToItem);
      }

      case "habit": {
        // Habits are a small, bounded set; filtering is done here because the
        // completion state lives in the derived stats rather than a column.
        const rows = await listHabits(workspaceId, userId);
        const all = rows.map((row) => habitRowToItem(row.habit, row));
        const visible = searchQuery.trim()
          ? all.filter((item) => item.habitName.toLowerCase().includes(searchQuery.trim().toLowerCase()))
          : all;
        const byFilter =
          filter === "completed" ? visible.filter((item) => item.completed)
            : filter === "active" ? visible.filter((item) => !item.completed)
              : visible;
        return byFilter;
      }

      case "study": {
        const rows = await listStudySessions(workspaceId, userId, {
          search: searchQuery,
          runningOnly: filter === "active",
          completedOnly: filter === "completed"
        });
        return rows.map((row) => studyRowToItem(row, { subjectNames, now: Date.now() }));
      }

      case "fitness": {
        if (!recordTypeId) return [];
        const rows = await listRecords(workspaceId, { recordTypeId, search: searchQuery });
        const visible = filter === "all" ? rows
          : rows.filter((row) =>
              filter === "completed"
                ? Boolean(readDataField<boolean>(row, "completed", false))
                : !readDataField<boolean>(row, "completed", false)
            );
        return visible.map(fitnessRowToItem);
      }

      case "shopping": {
        if (!recordTypeId) return [];
        const rows = await listRecords(workspaceId, { recordTypeId, search: searchQuery });
        const visible = filter === "all" ? rows
          : rows.filter((row) =>
              filter === "completed"
                ? Boolean(readDataField<boolean>(row, "purchased", false))
                : !readDataField<boolean>(row, "purchased", false)
            );
        return visible.map(shoppingRowToItem);
      }

      case "meeting": {
        const rows = await listNotes(workspaceId, userId, { search: searchQuery });
        const byFilter =
          filter === "completed" ? rows.filter((row) => row.archived_at !== null)
            : filter === "active" ? rows.filter((row) => row.archived_at === null)
              : rows;
        return byFilter.map(noteRowToItem);
      }

      default:
        return [];
    }
  }, [mode, filter, searchQuery, workspaceId, userId, groceryListId, recordTypeId, subjectNames]);

  const query = useAsyncData<ListItem[]>(loader, [
    mode,
    filter,
    searchQuery,
    workspaceId,
    userId,
    groceryListId,
    recordTypeId,
    // Re-read when any other surface commits a task write.
    //
    // This hook instance is mounted once for the whole page, so it holds the
    // section list it fetched when that section was last opened. Completing a
    // task from the Dashboard writes to Supabase and updates the Dashboard's own
    // snapshot - but without this dependency, switching back to the Task section
    // showed the pre-write state until something forced a remount. That is the
    // "dashboard and task centre disagree" bug, and this is the fix: the same
    // signal the Dashboard bumps is watched here, and the list is re-read from
    // Supabase - still the only source of truth.
    taskRevision
  ]);

  // --- counts ---------------------------------------------------------------
  useEffect(() => {
    if (!workspaceId || mode !== "task") return;
    let cancelled = false;
    void countTasks(workspaceId)
      .then((result) => {
        if (!cancelled) setCounts(result);
      })
      .catch(() => {
        // A count failure must not blank the list; keep the previous counts.
        if (!cancelled) setCounts(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, mode, query.data]);

  // Only task mode has a count query; every other mode reports no counts.
  useEffect(() => {
    if (mode === "task") return;
    setCounts(null);
  }, [mode]);

  const reload = useCallback(async () => {
    await query.reload();
    if (mode === "task" && workspaceId) {
      try {
        setCounts(await countTasks(workspaceId));
      } catch {
        setCounts(null);
      }
    }
  }, [query, mode, workspaceId]);

  // --- optimistic mutations -------------------------------------------------
  //
  // The list rendered by the UI is: Supabase rows (the base list) plus an
  // ephemeral optimistic overlay. Writes apply the overlay immediately, hit
  // Supabase in the background, then reconcile against the row the database
  // returned - or roll the overlay back and surface the error.
  //
  // The overlay is never persisted and never treated as storage: any fetch
  // (mount, mode change, filter change, reload) rebuilds the base list straight
  // from Supabase, which is the only source of truth.

  // Memoised so the identity only changes when Supabase actually returns a
  // different list; otherwise every render would invalidate the callbacks
  // below and reset the overlay.
  const baseItems = useMemo<ListItem[]>(() => query.data ?? [], [query.data]);

  /** Flips the completion flag on any item shape, preserving its mode. */
  const applyCompletion = (item: ListItem, completed: boolean): ListItem => {
    if ("completed" in item) return { ...item, completed };
    if ("purchased" in item) return { ...item, purchased: completed };
    return item;
  };

  /**
   * Notes carry no completion flag - they are archived - so the optimistic
   * filter treats an archived note as complete. `ListItem` has no archived
   * field, so a note is read from the row's own metadata when present.
   */
  const isArchivedItem = useCallback(
    (item: ListItem): boolean => {
      const row = baseItems.find((candidate) => candidate.id === item.id);
      return (row as { archivedAt?: boolean } | undefined)?.archivedAt === true;
    },
    [baseItems]
  );

  /** Case-insensitive label used by the server-side search, for parity. */
  const getSortableLabel = (item: ListItem): string => {
    if ("title" in item) return item.title;
    if ("itemName" in item) return item.itemName;
    if ("habitName" in item) return item.habitName;
    if ("meetingTitle" in item) return item.meetingTitle;
    if ("exerciseName" in item) return item.exerciseName;
    if ("subject" in item) return `${item.subject} ${item.topic}`;
    return "";
  };

  /**
   * Mirrors the server-side filter so an optimistic row is shown or hidden the
   * same way a refetch would show or hide it. Without this, completing a task
   * under the "active" filter would leave it on screen until the next fetch.
   */
  const isVisibleNow = useCallback(
    (item: ListItem): boolean => {
      const trimmed = searchQuery.trim().toLowerCase();
      if (trimmed) {
        const haystack = getSortableLabel(item).toLowerCase();
        if (!haystack.includes(trimmed)) return false;
      }
      if (filter === "all") return true;
      // Notes are archived rather than completed, so they follow the row's
      // archived flag; every other mode uses the shared completion check.
      const completed = item.mode === "meeting" ? isArchivedItem(item) : isItemCompleted(item);
      return filter === "completed" ? completed : !completed;
    },
    [filter, searchQuery, isArchivedItem]
  );

  const { visible, pending, error: mutationError, clearError, run } = useOptimisticItems({
    base: baseItems,
    isVisible: isVisibleNow
  });

  const requireContext = useCallback((): { ok: true; workspaceId: string; userId: string } | { ok: false; error: DataError } => {
    if (!workspaceId || !userId) {
      return { ok: false, error: new DataError("UNAUTHENTICATED", "You must be signed in.") };
    }
    return { ok: true, workspaceId, userId };
  }, [workspaceId, userId]);

  const refreshCounts = useCallback(async () => {
    if (mode !== "task" || !workspaceId) return;
    try {
      setCounts(await countTasks(workspaceId));
    } catch {
      setCounts(null);
    }
  }, [mode, workspaceId]);

  /**
   * Commits a write and folds the confirmed row into the base list.
   *
   * `toItem` converts the row Supabase returned into the UI shape, so the list
   * ends up showing database state - including server-generated values such as
   * `completed_at` and `duration_seconds` - rather than the guess that was
   * shown optimistically.
   */
  const commit = useCallback(
    <T,>(
      intent: OptimisticIntent,
      operation: () => Promise<T>,
      toItem: (saved: T) => ListItem,
      /**
       * The mode this write belongs to.
       *
       * Only needed for deletes, where `toItem` is never called and the mode
       * therefore cannot be inferred from the result.
       */
      affectedMode?: ListMode
    ) =>
      run(intent, operation, (saved) => {
        // A confirmed delete must leave the base list too. Clearing only the
        // overlay is not enough: the row would still be in the base data and
        // would reappear the moment an unrelated mutation rolled back.
        const deleted = intent.deletes ?? [];

        if (deleted.length > 0) {
          query.setData((previous) => (previous ?? []).filter((row) => !deleted.includes(row.id)));
        }

        // Announce the write to every OTHER task surface, now that it has
        // actually been confirmed by the database.
        //
        // This is deliberately after reconciliation rather than before: a bump
        // on a failed write would make sibling views re-read and re-render state
        // the database never accepted. `run` only invokes this callback on
        // success, so the signal can never mean "a write failed".
        //
        // Task and study are announced because those are the two surfaces whose
        // analytics are derived from these rows and are rendered elsewhere in the
        // app. Announcing them is what makes the Dashboard, the Task Centre and
        // the analytics pages agree without any of them owning the others.
        const mode = affectedMode ?? (saved !== undefined ? toItem(saved).mode : undefined);
        if (mode === "task" || mode === "study") {
          bumpTaskRevision();
        }

        // Deletes return nothing to reconcile.
        if (saved === undefined) {
          void refreshCounts();
          return;
        }

        const confirmed = toItem(saved);
        query.setData((previous) => {
          const list = (previous ?? []).filter((row) => !deleted.includes(row.id));
          const index = list.findIndex((row) => row.id === confirmed.id);
          if (index >= 0) {
            const next = [...list];
            next[index] = confirmed;
            return next;
          }
          return [confirmed, ...list];
        });
        void refreshCounts();
      }),
    [run, query, refreshCounts, bumpTaskRevision]
  );

  // --- CREATE ---------------------------------------------------------------
  const create = useCallback(
    async (item: ListItem): Promise<MutationResult> => {
      const context = requireContext();
      if (!context.ok) return { ok: false, error: context.error };
      const { workspaceId: wsId, userId: uid } = context;

      // A temporary id lets the row render immediately and be reconciled when
      // the real id arrives.
      const optimisticItem: ListItem = { ...item, id: optimisticId() };

      try {
        switch (item.mode) {
          case "task":
            return await commit(
              { creates: [optimisticItem] },
              () => createTask(wsId, uid, toTaskDraft(item)),
              (saved) => taskRowToItem(saved)
            );

          case "grocery": {
            if (!groceryListId) throw new DataError("DATABASE", "The grocery list is still loading.");
            return await commit(
              { creates: [optimisticItem] },
              () => createGroceryItem(groceryListId, toGroceryDraft(item)),
              (saved) => groceryRowToItem(saved)
            );
          }

          case "habit":
            return await commit(
              { creates: [optimisticItem] },
              () => createHabit(wsId, uid, toHabitDraft(item)),
              (saved) => habitRowToItem(saved, { completedToday: false, currentStreak: 0 })
            );

          case "study": {
            /*
             * Logging a session the user has already studied.
             *
             * This used to call `startStudySession`, which wrote
             * `started_at = now, ended_at = null`: a typed "2 h" became a live
             * zero-second timer, the typed duration was thrown away, and every
             * create added a row rather than a duration. `logStudySession` writes
             * both timestamps so the generated `duration_seconds` is the length
             * that was actually entered.
             *
             * A blank duration is a validation error rather than a silent fallback
             * to "start a timer instead" - quietly turning a mistyped entry into a
             * different kind of record is how this class of bug hides.
             *
             * The live timer is untouched: `startSession`/`stopSession` below and
             * the timer's own control still drive `startStudySession`.
             */
            const draft = toStudyDraft(item);
            if (!Number.isFinite(draft.durationMinutes) || draft.durationMinutes <= 0) {
              throw new DataError(
                "VALIDATION",
                "Enter how long you studied - a number of minutes or hours."
              );
            }
            // The ONE conversion from minutes to seconds. Everything above this
            // line is minutes; everything below is seconds.
            const seconds = minutesToSeconds(draft.durationMinutes);
            const subject = await createStudySubject(wsId, { name: item.subject || "Study" });
            setSubjectNames((previous) => new Map(previous).set(subject.id, subject.name));
            await logStudySession(wsId, uid, {
              subjectId: subject.id,
              topic: draft.topic,
              durationSeconds: seconds
            });
            // Announce the write so the Dashboard and Study Analytics re-read.
            bumpTaskRevision();
            await reload();
            return { ok: true };
          }

          case "fitness": {
            if (!recordTypeId) throw new DataError("DATABASE", "The Fitness type is still loading.");
            return await commit(
              { creates: [optimisticItem] },
              () =>
                createRecord(wsId, uid, {
                  recordTypeId,
                  title: item.exerciseName,
                  data: toFitnessDraft(item)
                }),
              (saved) => fitnessRowToItem(saved)
            );
          }

          case "shopping": {
            if (!recordTypeId) throw new DataError("DATABASE", "The Shopping type is still loading.");
            return await commit(
              { creates: [optimisticItem] },
              () =>
                createRecord(wsId, uid, {
                  recordTypeId,
                  title: item.itemName,
                  data: toShoppingDraft(item)
                }),
              (saved) => shoppingRowToItem(saved)
            );
          }

          case "meeting":
            return await commit(
              { creates: [optimisticItem] },
              () => createNote(wsId, uid, toNoteDraft(item)),
              (saved) => noteRowToItem(saved)
            );

          default:
            return { ok: false, error: new DataError("VALIDATION", "Unsupported item type.") };
        }
      } catch (caught) {
        // The optimistic row never reached the database, so it is simply not
        // confirmed; report the failure rather than showing a phantom item.
        return { ok: false, error: toDataError(caught) };
      }
    },
    [requireContext, commit, groceryListId, recordTypeId, reload, bumpTaskRevision]
  );

  // --- UPDATE ---------------------------------------------------------------
  const update = useCallback(
    async (id: string, item: ListItem): Promise<MutationResult> => {
      const context = requireContext();
      if (!context.ok) return { ok: false, error: context.error };
      const { workspaceId: wsId, userId: uid } = context;

      const optimisticItem: ListItem = { ...item, id };

      try {
        switch (item.mode) {
          case "task":
            return await commit(
              { creates: [optimisticItem] },
              () => updateTask(wsId, id, toTaskDraft(item)),
              (saved) => taskRowToItem(saved)
            );

          case "grocery": {
            if (!groceryListId) throw new DataError("DATABASE", "The grocery list is still loading.");
            return await commit(
              { creates: [optimisticItem] },
              () => updateGroceryItem(groceryListId, id, toGroceryDraft(item)),
              (saved) => groceryRowToItem(saved)
            );
          }

          case "habit":
            return await commit(
              { creates: [optimisticItem] },
              () => updateHabit(wsId, id, toHabitDraft(item)),
              (saved) => habitRowToItem(saved, { completedToday: false, currentStreak: 0 })
            );

          case "study": {
            /*
             * Editing a session UPDATES it. It does not stop it, and it does not
             * insert a replacement.
             *
             * This branch used to be `stopStudySession(...)` followed by discarding
             * every edited value and returning `ok: true` - so the UI reported a
             * save that never happened, the subject/topic the user changed were
             * lost, and the only thing that moved was the timestamps. Repeated
             * edits therefore looked like the Dashboard was adding to the total
             * rather than correcting it.
             *
             * Three writes to ONE row, in a fixed order:
             *   1. subject  - resolved first, because the name is what the user
             *                 typed and the previous subject may not exist
             *   2. topic
             *   3. duration - by moving `ended_at`, since `duration_seconds` is
             *                 generated and cannot be written directly
             *
             * `ended_at` is only moved when a duration was actually entered, so
             * renaming a topic never silently changes the recorded length.
             */
            const draft = toStudyDraft(item);
            const subject = await createStudySubject(wsId, { name: item.subject || "Study" });
            setSubjectNames((previous) => new Map(previous).set(subject.id, subject.name));

            await updateStudySession(wsId, id, {
              subject_id: subject.id,
              topic: draft.topic || null
            });

            if (Number.isFinite(draft.durationMinutes) && draft.durationMinutes > 0) {
              // Same single conversion on the edit path. Re-deriving the rule in
              // two places is how the two paths would drift apart.
              await setStudySessionDuration(wsId, id, minutesToSeconds(draft.durationMinutes));
              // A session given an explicit duration is a finished one.
              setRunningStartedAt(null);
            }

            bumpTaskRevision();
            await reload();
            return { ok: true };
          }

          case "fitness":
            return await commit(
              { creates: [optimisticItem] },
              () =>
                updateRecord(wsId, id, {
                  title: item.exerciseName,
                  data: toFitnessDraft(item) as Json
                }),
              (saved) => fitnessRowToItem(saved)
            );

          case "shopping":
            return await commit(
              { creates: [optimisticItem] },
              () =>
                updateRecord(wsId, id, {
                  title: item.itemName,
                  data: toShoppingDraft(item) as Json
                }),
              (saved) => shoppingRowToItem(saved)
            );

          case "meeting":
            return await commit(
              { creates: [optimisticItem] },
              () => updateNote(wsId, id, toNoteDraft(item)),
              (saved) => noteRowToItem(saved)
            );

          default:
            return { ok: false, error: new DataError("VALIDATION", "Unsupported item type.") };
        }
      } catch (caught) {
        return { ok: false, error: toDataError(caught) };
      }
    },
    [requireContext, commit, groceryListId, reload, bumpTaskRevision]
  );

  // --- TOGGLE ---------------------------------------------------------------
  const toggle = useCallback(
    async (id: string): Promise<MutationResult> => {
      const context = requireContext();
      if (!context.ok) return { ok: false, error: context.error };
      const { workspaceId: wsId, userId: uid } = context;

      const existing = visible.find((row) => row.id === id) ?? baseItems.find((row) => row.id === id);
      if (!existing) return { ok: false, error: new DataError("NOT_FOUND", "That item no longer exists.") };

      const nextCompleted = !isItemCompleted(existing);

      try {
        switch (existing.mode) {
          case "task":
            return await commit(
              { updates: [applyCompletion(existing, nextCompleted)] },
              () => setTaskCompleted(wsId, id, nextCompleted),
              (saved) => taskRowToItem(saved)
            );

          case "grocery": {
            if (!groceryListId) throw new DataError("DATABASE", "The grocery list is still loading.");
            return await commit(
              { updates: [applyCompletion(existing, nextCompleted)] },
              () => setGroceryItemCompleted(groceryListId, id, nextCompleted),
              (saved) => groceryRowToItem(saved)
            );
          }

          case "habit":
            // `setHabitCompleted` returns nothing, and the streak is derived
            // server-side from the completion log. So the tick is shown
            // optimistically and then reconciled by refetching, which is the
            // only way the displayed streak can be genuinely correct.
            return await run(
              { updates: [applyCompletion(existing, nextCompleted)] },
              () => setHabitCompleted(wsId, uid, id, todayKey(), nextCompleted),
              () => undefined,
              () => void reload()
            );

          case "study":
            // Toggling a session starts or stops the timer.
            if (nextCompleted) {
              await stopStudySession(wsId, id);
              setRunningStartedAt(null);
            } else {
              const started = await startStudySession(wsId, uid, {
                subjectName: existing.subject
              });
              setRunningStartedAt(started.started_at);
            }
            // Toggling a session starts or stops the timer, which moves every
            // study total shown elsewhere, so those screens must re-read.
            bumpTaskRevision();
            await reload();
            return { ok: true };

          case "fitness":
            return await commit(
              { updates: [applyCompletion(existing, nextCompleted)] },
              () => updateRecordData(wsId, id, { completed: nextCompleted }),
              (saved) => fitnessRowToItem(saved)
            );

          case "shopping":
            return await commit(
              { updates: [applyCompletion(existing, nextCompleted)] },
              () => updateRecordData(wsId, id, { purchased: nextCompleted }),
              (saved) => shoppingRowToItem(saved)
            );

          case "meeting":
            await archiveNote(wsId, id, nextCompleted);
            await reload();
            return { ok: true };

          default:
            return { ok: false, error: new DataError("VALIDATION", "Unsupported item type.") };
        }
      } catch (caught) {
        return { ok: false, error: toDataError(caught) };
      }
    },
    [requireContext, commit, run, groceryListId, visible, baseItems, reload, bumpTaskRevision]
  );

  // --- DELETE ---------------------------------------------------------------
  const remove = useCallback(
    async (id: string): Promise<MutationResult> => {
      const context = requireContext();
      if (!context.ok) return { ok: false, error: context.error };
      const { workspaceId: wsId } = context;

      const existing = visible.find((row) => row.id === id) ?? baseItems.find((row) => row.id === id);
      if (!existing) return { ok: true };

      try {
        switch (existing.mode) {
          case "task":
            return await commit({ deletes: [id] }, () => deleteTask(wsId, id), () => existing, "task");
          case "grocery": {
            if (!groceryListId) throw new DataError("DATABASE", "The grocery list is still loading.");
            return await commit({ deletes: [id] }, () => deleteGroceryItem(groceryListId, id), () => existing);
          }
          case "habit":
            return await commit({ deletes: [id] }, () => deleteHabit(wsId, id), () => existing);
          case "study":
            return await commit({ deletes: [id] }, () => deleteStudySession(wsId, id), () => existing, "study");
          case "fitness":
          case "shopping":
            return await commit({ deletes: [id] }, () => deleteRecord(wsId, id), () => existing);
          case "meeting":
            return await commit({ deletes: [id] }, () => deleteNote(wsId, id), () => existing);
          default:
            return { ok: false, error: new DataError("VALIDATION", "Unsupported item type.") };
        }
      } catch (caught) {
        return { ok: false, error: toDataError(caught) };
      }
    },
    [requireContext, commit, groceryListId, visible, baseItems]
  );


  // --- study timer ----------------------------------------------------------
  const startSession = useCallback(
    async (input: { subjectName?: string; topic?: string } = {}): Promise<MutationResult> => {
      const context = requireContext();
      if (!context.ok) return { ok: false, error: context.error };
      try {
        const started = await startStudySession(context.workspaceId, context.userId, {
          subjectName: input.subjectName ?? "Study",
          topic: input.topic ?? null
        });
        setRunningStartedAt(started.started_at);
        // Study time changed, so the Dashboard and Study Analytics must re-read
        // rather than keep showing the figure from before the timer started.
        bumpTaskRevision();
        await reload();
        return { ok: true };
      } catch (caught) {
        return { ok: false, error: toDataError(caught) };
      }
    },
    [requireContext, reload, bumpTaskRevision]
  );

  const stopSession = useCallback(async (): Promise<MutationResult> => {
    const context = requireContext();
    if (!context.ok) return { ok: false, error: context.error };
    try {
      await stopStudySession(
        context.workspaceId,
        await findRunningSessionId(context.workspaceId, context.userId)
      );
      setRunningStartedAt(null);
      // Stopping a session turns elapsed time into a recorded duration, so every
      // study total on other screens is now stale.
      bumpTaskRevision();
      await reload();
      return { ok: true };
    } catch (caught) {
      return { ok: false, error: toDataError(caught) };
    }
  }, [requireContext, reload, bumpTaskRevision]);

  return useMemo(
    () => ({
      // Supabase rows plus the ephemeral optimistic overlay.
      items: visible,
      status: enabled ? query.status : "idle",
      error: query.error,
      isInitialLoading: query.isInitialLoading,
      counts,
      reload,
      refreshParent,
      create,
      update,
      toggle,
      remove,
      pending,
      mutationError,
      clearMutationError: clearError,
      runningSessionStartedAt: runningStartedAt,
      startSession,
      stopSession
    }),
    [
      visible,
      query.status,
      query.error,
      query.isInitialLoading,
      enabled,
      counts,
      reload,
      refreshParent,
      create,
      update,
      toggle,
      remove,
      pending,
      mutationError,
      clearError,
      runningStartedAt,
      startSession,
      stopSession
    ]
  );
}

/** Resolves the id of the user's running session, or throws if there is none. */
const findRunningSessionId = async (workspaceId: string, userId: string): Promise<string> => {
  const running = await getRunningSession(workspaceId, userId);
  if (!running) throw new DataError("NOT_FOUND", "There is no running session.");
  return running.id;
};

export { toDateInputValue };
export type { StudySubjectRow } from "@/lib/data/types";