import { db } from "@/lib/data/client";
import { toDataError, validationError } from "@/lib/data/errors";
import type {
  TaskCategoryRow,
  TaskInsert,
  TaskRow,
  TaskStatus,
  TaskUpdate
} from "@/lib/data/types";

/**
 * Task and task-category access.
 *
 * Filtering is done in the database rather than in the browser: `listTasks`
 * accepts the same filter/search the UI toolbar exposes, so switching a filter
 * does not require refetching every task in the workspace and then discarding
 * most of them.
 */

/** Mirrors the toolbar's filter tabs. */
export type TaskCompletionFilter = "all" | "active" | "completed";

export type ListTasksOptions = {
  filter?: TaskCompletionFilter;
  search?: string;
  /** Cap on rows returned. Omit for no limit. */
  limit?: number;
  offset?: number;
};

const ACTIVE_STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked"];

/** Escapes the LIKE metacharacters so a user's search text is treated literally. */
const escapeLike = (value: string) => value.replace(/[%_]/g, (c) => `\\${c}`);

export const listTasks = async (
  workspaceId: string,
  options: ListTasksOptions = {}
): Promise<TaskRow[]> => {
  const { filter = "all", search = "", limit, offset } = options;

  let query = db().from("tasks").select("*").eq("workspace_id", workspaceId);

  if (filter === "active") query = query.in("status", ACTIVE_STATUSES);
  else if (filter === "completed") query = query.eq("status", "done");

  const trimmed = search.trim();
  if (trimmed) {
    // Only the searchable columns are matched - unlike the previous
    // client-side implementation, which matched every value on the object
    // including ids and timestamps.
    query = query.or(
      `title.ilike.%${escapeLike(trimmed)}%,description.ilike.%${escapeLike(trimmed)}%`
    );
  }

  // Open tasks first (soonest due date at the top), then the rest by recency.
  query = query
    .order("status", { ascending: true })
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (typeof limit === "number") query = query.limit(limit);
  if (typeof offset === "number") query = query.range(offset, offset + (limit ?? 50) - 1);

  const { data, error } = await query;
  if (error) throw toDataError(error, "Could not load your tasks.");
  return data ?? [];
};

export const countTasks = async (workspaceId: string): Promise<{ all: number; active: number; completed: number }> => {
  const { data, error } = await db()
    .from("tasks")
    .select("status", { count: "exact" })
    .eq("workspace_id", workspaceId);
  if (error) throw toDataError(error, "Could not count your tasks.");

  const rows = data ?? [];
  const completed = rows.filter((r) => r.status === "done").length;
  return { all: rows.length, completed, active: rows.length - completed };
};

/**
 * Validates a deadline at the data-access layer.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT ONLY IN THE FORM
 * ---------------------------------------------------------------------------
 * A `required` attribute on an input is a convenience, not a constraint: it is
 * trivially bypassed by any client that talks to Supabase directly, by a crafted
 * API call, or by a bug in the UI. Enforcing the rule here means it holds for
 * every write path, not just the one the user happens to use.
 *
 * `due_at` itself stays NULLABLE in the database - 3 of the 6 existing tasks
 * have no deadline, and a NOT NULL constraint would fail the migration outright.
 * So this guards NEW writes while legacy rows continue to exist and are shown in
 * the UI as "No deadline" rather than being given an invented date.
 */
const assertDeadline = (dueAt: string | null | undefined): void => {
  if (!dueAt || !String(dueAt).trim()) {
    throw validationError("A task needs a deadline.");
  }
  if (Number.isNaN(new Date(String(dueAt)).getTime())) {
    throw validationError("That deadline is not a valid date.");
  }
};

export const createTask = async (
  workspaceId: string,
  createdBy: string,
  input: Omit<TaskInsert, "workspace_id" | "created_by">
): Promise<TaskRow> => {
  if (!input.title?.trim()) throw validationError("A task needs a title.");
  assertDeadline(input.due_at);

  const { data, error } = await db()
    .from("tasks")
    .insert({ ...input, title: input.title.trim(), workspace_id: workspaceId, created_by: createdBy })
    .select("*")
    .single();
  if (error) throw toDataError(error, "Could not create the task.");
  return data;
};

export const updateTask = async (
  workspaceId: string,
  taskId: string,
  patch: TaskUpdate
): Promise<TaskRow> => {
  if (patch.title != null && !patch.title.trim()) {
    throw validationError("A task needs a title.");
  }
  // A deadline can be changed but not removed. Note this only fires when the key
  // is actually present, so a bare title edit on a legacy task (which already has
  // no deadline) is not blocked by a pre-existing gap.
  if (patch.due_at !== undefined) assertDeadline(patch.due_at);

  const { data, error } = await db()
    .from("tasks")
    .update(patch)
    .eq("workspace_id", workspaceId)
    .eq("id", taskId)
    .select("*")
    .single();
  if (error) throw toDataError(error, "Could not update the task.");
  return data;
};

/**
 * Marks a task done or not done.
 *
 * `completed_at` is intentionally NOT sent: the `tasks_sync_completed_at`
 * trigger sets and preserves it, which keeps the timestamp correct no matter
 * which client performed the change.
 */
export const setTaskCompleted = async (
  workspaceId: string,
  taskId: string,
  completed: boolean
): Promise<TaskRow> =>
  updateTask(workspaceId, taskId, { status: completed ? "done" : "todo" });

export const deleteTask = async (workspaceId: string, taskId: string): Promise<void> => {
  const { error } = await db().from("tasks").delete().eq("workspace_id", workspaceId).eq("id", taskId);
  if (error) throw toDataError(error, "Could not delete the task.");
};

// ---------------------------------------------------------------------------
// Task categories
// ---------------------------------------------------------------------------

export const listTaskCategories = async (workspaceId: string): Promise<TaskCategoryRow[]> => {
  const { data, error } = await db()
    .from("task_categories")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true });
  if (error) throw toDataError(error, "Could not load task categories.");
  return data ?? [];
};

export const createTaskCategory = async (
  workspaceId: string,
  name: string
): Promise<TaskCategoryRow> => {
  if (!name.trim()) throw validationError("A category needs a name.");

  const { data, error } = await db()
    .from("task_categories")
    .insert({ workspace_id: workspaceId, name: name.trim() })
    .select("*")
    .single();
  if (error) throw toDataError(error, "Could not create the category.");
  return data;
};

export const deleteTaskCategory = async (workspaceId: string, categoryId: string): Promise<void> => {
  const { error } = await db()
    .from("task_categories")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", categoryId);
  if (error) throw toDataError(error, "Could not delete the category.");
};

/** Task ids grouped by category id. */
export const listTaskCategoryLinks = async (
  workspaceId: string
): Promise<{ task_id: string; category_id: string }[]> => {
  const { data, error } = await db()
    .from("task_category_links")
    .select("task_id, category_id")
    .eq("workspace_id", workspaceId);
  if (error) throw toDataError(error, "Could not load task categories.");
  return data ?? [];
};

export const setTaskCategories = async (
  workspaceId: string,
  taskId: string,
  categoryIds: string[]
): Promise<void> => {
  if (categoryIds.length === 0) {
    const { error } = await db()
      .from("task_category_links")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("task_id", taskId);
    if (error) throw toDataError(error, "Could not update task categories.");
    return;
  }

  const { error } = await db().from("task_category_links").upsert(
    categoryIds.map((categoryId) => ({ workspace_id: workspaceId, task_id: taskId, category_id: categoryId })),
    { onConflict: "task_id,category_id", ignoreDuplicates: true }
  );
  if (error) throw toDataError(error, "Could not update task categories.");
};