"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setTaskCategories = exports.listTaskCategoryLinks = exports.deleteTaskCategory = exports.createTaskCategory = exports.listTaskCategories = exports.deleteTask = exports.setTaskCompleted = exports.updateTask = exports.createTask = exports.countTasks = exports.listTasks = void 0;
const client_1 = require("./stub-client.js");
const errors_1 = require("./stub-errors.js");
const ACTIVE_STATUSES = ["todo", "in_progress", "blocked"];
/** Escapes the LIKE metacharacters so a user's search text is treated literally. */
const escapeLike = (value) => value.replace(/[%_]/g, (c) => `\\${c}`);
const listTasks = async (workspaceId, options = {}) => {
    const { filter = "all", search = "", limit, offset } = options;
    let query = (0, client_1.db)().from("tasks").select("*").eq("workspace_id", workspaceId);
    if (filter === "active")
        query = query.in("status", ACTIVE_STATUSES);
    else if (filter === "completed")
        query = query.eq("status", "done");
    const trimmed = search.trim();
    if (trimmed) {
        // Only the searchable columns are matched - unlike the previous
        // client-side implementation, which matched every value on the object
        // including ids and timestamps.
        query = query.or(`title.ilike.%${escapeLike(trimmed)}%,description.ilike.%${escapeLike(trimmed)}%`);
    }
    // Open tasks first (soonest due date at the top), then the rest by recency.
    query = query
        .order("status", { ascending: true })
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
    if (typeof limit === "number")
        query = query.limit(limit);
    if (typeof offset === "number")
        query = query.range(offset, offset + (limit ?? 50) - 1);
    const { data, error } = await query;
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not load your tasks.");
    return data ?? [];
};
exports.listTasks = listTasks;
const countTasks = async (workspaceId) => {
    const { data, error } = await (0, client_1.db)()
        .from("tasks")
        .select("status", { count: "exact" })
        .eq("workspace_id", workspaceId);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not count your tasks.");
    const rows = data ?? [];
    const completed = rows.filter((r) => r.status === "done").length;
    return { all: rows.length, completed, active: rows.length - completed };
};
exports.countTasks = countTasks;
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
const assertDeadline = (dueAt) => {
    if (!dueAt || !String(dueAt).trim()) {
        throw (0, errors_1.validationError)("A task needs a deadline.");
    }
    if (Number.isNaN(new Date(String(dueAt)).getTime())) {
        throw (0, errors_1.validationError)("That deadline is not a valid date.");
    }
};
const createTask = async (workspaceId, createdBy, input) => {
    if (!input.title?.trim())
        throw (0, errors_1.validationError)("A task needs a title.");
    assertDeadline(input.due_at);
    const { data, error } = await (0, client_1.db)()
        .from("tasks")
        .insert({ ...input, title: input.title.trim(), workspace_id: workspaceId, created_by: createdBy })
        .select("*")
        .single();
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not create the task.");
    return data;
};
exports.createTask = createTask;
const updateTask = async (workspaceId, taskId, patch) => {
    if (patch.title != null && !patch.title.trim()) {
        throw (0, errors_1.validationError)("A task needs a title.");
    }
    // A deadline can be changed but not removed. Note this only fires when the key
    // is actually present, so a bare title edit on a legacy task (which already has
    // no deadline) is not blocked by a pre-existing gap.
    if (patch.due_at !== undefined)
        assertDeadline(patch.due_at);
    const { data, error } = await (0, client_1.db)()
        .from("tasks")
        .update(patch)
        .eq("workspace_id", workspaceId)
        .eq("id", taskId)
        .select("*")
        .single();
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not update the task.");
    return data;
};
exports.updateTask = updateTask;
/**
 * Marks a task done or not done.
 *
 * `completed_at` is intentionally NOT sent: the `tasks_sync_completed_at`
 * trigger sets and preserves it, which keeps the timestamp correct no matter
 * which client performed the change.
 */
const setTaskCompleted = async (workspaceId, taskId, completed) => (0, exports.updateTask)(workspaceId, taskId, { status: completed ? "done" : "todo" });
exports.setTaskCompleted = setTaskCompleted;
const deleteTask = async (workspaceId, taskId) => {
    const { error } = await (0, client_1.db)().from("tasks").delete().eq("workspace_id", workspaceId).eq("id", taskId);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not delete the task.");
};
exports.deleteTask = deleteTask;
// ---------------------------------------------------------------------------
// Task categories
// ---------------------------------------------------------------------------
const listTaskCategories = async (workspaceId) => {
    const { data, error } = await (0, client_1.db)()
        .from("task_categories")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("name", { ascending: true });
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not load task categories.");
    return data ?? [];
};
exports.listTaskCategories = listTaskCategories;
const createTaskCategory = async (workspaceId, name) => {
    if (!name.trim())
        throw (0, errors_1.validationError)("A category needs a name.");
    const { data, error } = await (0, client_1.db)()
        .from("task_categories")
        .insert({ workspace_id: workspaceId, name: name.trim() })
        .select("*")
        .single();
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not create the category.");
    return data;
};
exports.createTaskCategory = createTaskCategory;
const deleteTaskCategory = async (workspaceId, categoryId) => {
    const { error } = await (0, client_1.db)()
        .from("task_categories")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("id", categoryId);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not delete the category.");
};
exports.deleteTaskCategory = deleteTaskCategory;
/** Task ids grouped by category id. */
const listTaskCategoryLinks = async (workspaceId) => {
    const { data, error } = await (0, client_1.db)()
        .from("task_category_links")
        .select("task_id, category_id")
        .eq("workspace_id", workspaceId);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not load task categories.");
    return data ?? [];
};
exports.listTaskCategoryLinks = listTaskCategoryLinks;
const setTaskCategories = async (workspaceId, taskId, categoryIds) => {
    if (categoryIds.length === 0) {
        const { error } = await (0, client_1.db)()
            .from("task_category_links")
            .delete()
            .eq("workspace_id", workspaceId)
            .eq("task_id", taskId);
        if (error)
            throw (0, errors_1.toDataError)(error, "Could not update task categories.");
        return;
    }
    const { error } = await (0, client_1.db)().from("task_category_links").upsert(categoryIds.map((categoryId) => ({ workspace_id: workspaceId, task_id: taskId, category_id: categoryId })), { onConflict: "task_id,category_id", ignoreDuplicates: true });
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not update task categories.");
};
exports.setTaskCategories = setTaskCategories;
