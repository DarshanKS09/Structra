import { db } from "@/lib/data/client";
import { toDataError } from "@/lib/data/errors";
import type { TaskStatus } from "@/lib/data/types";
import { REMINDER_OPEN_STATUSES } from "@/lib/data/reminders";

/**
 * Task analytics.
 *
 * ---------------------------------------------------------------------------
 * DERIVED, NEVER STORED
 * ---------------------------------------------------------------------------
 * Every number here is computed from `tasks` rows at read time. Nothing is
 * aggregated into a table or cached, because a stored total is a second source
 * of truth that has to be maintained on every insert, edit, un-complete and
 * delete - and that inevitably disagrees with the rows it summarises. The task
 * rows are the record; these are readouts of it.
 *
 * ---------------------------------------------------------------------------
 * COUNTS USE HEAD REQUESTS
 * ---------------------------------------------------------------------------
 * `head: true` makes PostgREST return the row COUNT and no body. Counting does
 * not need the rows, so the completed/pending/overdue split costs three cheap
 * index scans rather than downloading every task and counting in JavaScript.
 * That is the difference between the analytics scaling with the workspace and
 * scaling with the user's task list.
 *
 * ---------------------------------------------------------------------------
 * THE DAY BOUNDARY
 * ---------------------------------------------------------------------------
 * "Due today" is a local-calendar concept, but the database has no idea where
 * the user is. The window is therefore computed HERE, in the user's own
 * timezone, and sent as two absolute instants. The database never has to guess a
 * timezone, and the result is exactly "today where the user is sitting".
 *
 * `due_at` is stored as an absolute instant, so this conversion is exact
 * regardless of which timezone the user is in.
 */

/** A window of absolute instants bounding one local calendar period. */
export type DayWindow = { start: string; end: string };

const iso = (d: Date) => d.toISOString();

/**
 * Absolute bounds of a local calendar day, as a half-open interval
 * `[startOfDay, startOfNextDay)`.
 *
 * Built with local getters so the day matches the user's wall clock. Using UTC
 * boundaries would make "due today" wrong for every user who is not on UTC.
 */
export const localDayWindow = (reference: Date): DayWindow => {
  const start = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  return { start: iso(start), end: iso(end) };
};

/** Bounds of the last `days` local calendar days, oldest first, including today. */
export const localDayWindows = (reference: Date, days: number): DayWindow[] => {
  const windows: DayWindow[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(reference);
    day.setDate(day.getDate() - offset);
    windows.push(localDayWindow(day));
  }
  return windows;
};

/**
 * Awaits a `head: true` count query and returns the number.
 *
 * Taking the finished query rather than a builder callback keeps this fully
 * typed without re-declaring PostgREST's builder generics, and reads at the call
 * site as exactly the query it runs.
 */
const headCount = async (
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>
): Promise<number> => {
  const { count, error } = await query;
  if (error) throw toDataError(error, "Could not read your task analytics.");
  return count ?? 0;
};

/** Starts a workspace-scoped count on `tasks`. */
const countQuery = (workspaceId: string) =>
  db().from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);

export type TaskAnalytics = {
  total: number;
  completed: number;
  pending: number;
  /** Incomplete AND past its deadline. Completed tasks are never overdue. */
  overdue: number;
  /** Incomplete AND due before the end of today. */
  dueToday: number;
  /** Incomplete AND due within the next 7 days, excluding due-today. */
  dueThisWeek: number;
  /** Incomplete with no deadline - only possible for pre-existing tasks. */
  noDeadline: number;
  /** 0..100, rounded. 0 when there are no tasks at all. */
  completionRate: number;
};

/**
 * Statuses that still count as work.
 *
 * Re-exported from the reminders module rather than redeclared, so the analytics
 * counts and the reminder sweep cannot drift apart. `done` is deliberately
 * absent, which is what makes "completed tasks are never counted as overdue" a
 * property of the query rather than a rule each caller has to remember.
 * `archived` is excluded too: an archived task is not pending work.
 */
const OPEN_STATUSES: TaskStatus[] = REMINDER_OPEN_STATUSES;

/**
 * The headline task metrics for one workspace.
 *
 * Run as parallel head counts: five index-covered queries, no task bodies
 * transferred.
 */
export const getTaskAnalytics = async (
  workspaceId: string,
  now: Date = new Date()
): Promise<TaskAnalytics> => {
  const today = localDayWindow(now);
  const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);

  const [total, completed, overdue, dueToday, dueThisWeek, noDeadline] = await Promise.all([
    headCount(countQuery(workspaceId)),
    headCount(countQuery(workspaceId).eq("status", "done")),
    // Overdue compares against NOW, not against the end of the day. Using the
    // day boundary would sweep in tasks that are merely due LATER today, which
    // is the opposite of what "overdue" means.
    //
    // The open-status filter is what makes a completed task incapable of
    // counting as overdue, rather than relying on every caller to remember to
    // exclude it.
    headCount(
      countQuery(workspaceId).in("status", OPEN_STATUSES).not("due_at", "is", null).lt("due_at", iso(now))
    ),
    headCount(
      countQuery(workspaceId)
        .in("status", OPEN_STATUSES)
        .not("due_at", "is", null)
        .gte("due_at", today.start)
        .lt("due_at", today.end)
    ),
    // The week AHEAD, starting after today so it does not overlap due-today.
    headCount(
      countQuery(workspaceId)
        .in("status", OPEN_STATUSES)
        .not("due_at", "is", null)
        .gte("due_at", today.end)
        .lt("due_at", iso(weekEnd))
    ),
    // Legacy rows only: the application requires a deadline on create, but
    // tasks written before that rule are still in the database and must be
    // accounted for rather than silently vanishing from the totals.
    headCount(countQuery(workspaceId).in("status", OPEN_STATUSES).is("due_at", null))
  ]);

  const pending = Math.max(0, total - completed);

  return {
    total,
    completed,
    pending,
    overdue,
    dueToday,
    dueThisWeek,
    noDeadline,
    completionRate: total === 0 ? 0 : Math.round((completed / total) * 100)
  };
};

/** A single point on the completion-over-time series. */
export type CompletionTrendPoint = {
  /** `YYYY-MM-DD` in the user's local calendar. */
  day: string;
  /** Tasks whose `completed_at` fell on this day. */
  completed: number;
};

const pad = (n: number) => `${n}`.padStart(2, "0");

/**
 * The local calendar day an instant falls on, as `YYYY-MM-DD`.
 *
 * Read straight off the Date's LOCAL getters, which is the whole point: an
 * instant at 23:30 UTC on the 8th is the 9th for someone two hours ahead, and
 * only local getters say so. Formatting with `toISOString()` would label it the
 * 8th and misplace every late-evening completion by a day.
 */
const localDayKey = (isoInstant: string): string | null => {
  const d = new Date(isoInstant);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * How many tasks were completed each day over a trailing window.
 *
 * Only `completed_at` and the window bounds are read - two columns, not the whole
 * table - and the buckets are filled client-side because the day boundaries are
 * local. Days with nothing completed are emitted as zeroes so the chart shows a
 * continuous axis instead of silently skipping them.
 */
export const getCompletionTrend = async (
  workspaceId: string,
  days: number,
  now: Date = new Date()
): Promise<CompletionTrendPoint[]> => {
  const windows = localDayWindows(now, days);
  const from = windows[0]?.start ?? iso(now);

  const empty = windows.map((window) => {
    const start = new Date(window.start);
    return {
      day: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
      completed: 0
    };
  });

  const { data, error } = await db()
    .from("tasks")
    .select("completed_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "done")
    .not("completed_at", "is", null)
    .gte("completed_at", from);

  if (error) throw toDataError(error, "Could not read your completion history.");

  const byDay = new Map(empty.map((point) => [point.day, point]));
  for (const row of data ?? []) {
    const key = localDayKey(row.completed_at as string);
    const point = key ? byDay.get(key) : undefined;
    // A bucket outside the requested window is ignored rather than invented.
    if (point) point.completed += 1;
  }
  return empty;
};

export type NamedBreakdown = { label: string; count: number };

/** Task counts by the user's own priority, for the detailed view. */
export const getPriorityBreakdown = async (
  workspaceId: string
): Promise<NamedBreakdown[]> => {
  const { data, error } = await db()
    .from("tasks")
    .select("priority")
    .eq("workspace_id", workspaceId);

  if (error) throw toDataError(error, "Could not read your priorities.");

  const order: Record<string, string> = { high: "High", medium: "Medium", low: "Low" };
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const label = order[row.priority] ?? "Unset";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  // Fixed order rather than descending count, so the legend does not reshuffle
  // every render when two buckets happen to tie.
  return ["High", "Medium", "Low", "Unset"]
    .filter((label) => counts.has(label))
    .map((label) => ({ label, count: counts.get(label) ?? 0 }));
};

/**
 * Task counts per category, plus an explicit bucket for uncategorised tasks.
 *
 * Reads the link table once and the category names once - two queries, not one
 * per task - which avoids the N+1 that resolving each task's category
 * individually would produce.
 */
export const getCategoryBreakdown = async (
  workspaceId: string
): Promise<NamedBreakdown[]> => {
  const [{ data: links, error: linkError }, { data: tasks, error: taskError }] = await Promise.all([
    db().from("task_category_links").select("task_id, category_id").eq("workspace_id", workspaceId),
    db().from("tasks").select("id").eq("workspace_id", workspaceId)
  ]);
  if (linkError) throw toDataError(linkError, "Could not read your categories.");
  if (taskError) throw toDataError(taskError, "Could not read your tasks.");

  const { data: categories } = await db()
    .from("task_categories")
    .select("id, name")
    .eq("workspace_id", workspaceId);

  const names = new Map((categories ?? []).map((c) => [c.id as string, c.name as string]));
  const perTask = new Map<string, string[]>();
  for (const link of links ?? []) {
    const list = perTask.get(link.task_id) ?? [];
    list.push(names.get(link.category_id) ?? "Untitled");
    perTask.set(link.task_id, list);
  }

  const counts = new Map<string, number>();
  for (const task of tasks ?? []) {
    const labels = perTask.get(task.id);
    // A task can carry several categories. It is counted under each rather than
    // being split fractionally, so the counts answer "how many tasks touch this
    // category" - and the UI says so.
    if (!labels || labels.length === 0) {
      counts.set("Uncategorised", (counts.get("Uncategorised") ?? 0) + 1);
    } else {
      for (const label of new Set(labels)) {
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
};

/** Everything the detailed analytics page needs, in one round of parallel reads. */
export const getDetailedTaskAnalytics = async (
  workspaceId: string,
  now: Date = new Date()
): Promise<{
  summary: TaskAnalytics;
  trend: CompletionTrendPoint[];
  priorities: NamedBreakdown[];
  categories: NamedBreakdown[];
}> => {
  const [summary, trend, priorities, categories] = await Promise.all([
    getTaskAnalytics(workspaceId, now),
    getCompletionTrend(workspaceId, 30, now),
    getPriorityBreakdown(workspaceId),
    getCategoryBreakdown(workspaceId)
  ]);
  return { summary, trend, priorities, categories };
};