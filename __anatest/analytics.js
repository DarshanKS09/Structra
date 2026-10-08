"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDetailedTaskAnalytics = exports.getCategoryBreakdown = exports.getPriorityBreakdown = exports.getCompletionTrend = exports.getTaskAnalytics = exports.localDayWindows = exports.localDayWindow = void 0;
const client_1 = require("./stub-client.js");
const errors_1 = require("./stub-errors.js");
const iso = (d) => d.toISOString();
/**
 * Absolute bounds of a local calendar day, as a half-open interval
 * `[startOfDay, startOfNextDay)`.
 *
 * Built with local getters so the day matches the user's wall clock. Using UTC
 * boundaries would make "due today" wrong for every user who is not on UTC.
 */
const localDayWindow = (reference) => {
    const start = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    return { start: iso(start), end: iso(end) };
};
exports.localDayWindow = localDayWindow;
/** Bounds of the last `days` local calendar days, oldest first, including today. */
const localDayWindows = (reference, days) => {
    const windows = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
        const day = new Date(reference);
        day.setDate(day.getDate() - offset);
        windows.push((0, exports.localDayWindow)(day));
    }
    return windows;
};
exports.localDayWindows = localDayWindows;
/**
 * Awaits a `head: true` count query and returns the number.
 *
 * Taking the finished query rather than a builder callback keeps this fully
 * typed without re-declaring PostgREST's builder generics, and reads at the call
 * site as exactly the query it runs.
 */
const headCount = async (query) => {
    const { count, error } = await query;
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not read your task analytics.");
    return count ?? 0;
};
/** Starts a workspace-scoped count on `tasks`. */
const countQuery = (workspaceId) => (0, client_1.db)().from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
/**
 * Statuses that still count as work.
 *
 * `done` is deliberately absent, which is what makes "completed tasks are never
 * counted as overdue" a property of the query rather than a rule each caller has
 * to remember. `archived` is excluded too: an archived task is not pending work.
 */
const OPEN_STATUSES = ["todo", "in_progress", "blocked"];
/**
 * The headline task metrics for one workspace.
 *
 * Run as parallel head counts: five index-covered queries, no task bodies
 * transferred.
 */
const getTaskAnalytics = async (workspaceId, now = new Date()) => {
    const today = (0, exports.localDayWindow)(now);
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
        headCount(countQuery(workspaceId).in("status", OPEN_STATUSES).not("due_at", "is", null).lt("due_at", iso(now))),
        headCount(countQuery(workspaceId)
            .in("status", OPEN_STATUSES)
            .not("due_at", "is", null)
            .gte("due_at", today.start)
            .lt("due_at", today.end)),
        // The week AHEAD, starting after today so it does not overlap due-today.
        headCount(countQuery(workspaceId)
            .in("status", OPEN_STATUSES)
            .not("due_at", "is", null)
            .gte("due_at", today.end)
            .lt("due_at", iso(weekEnd))),
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
exports.getTaskAnalytics = getTaskAnalytics;
const pad = (n) => `${n}`.padStart(2, "0");
/**
 * The local calendar day an instant falls on, as `YYYY-MM-DD`.
 *
 * Read straight off the Date's LOCAL getters, which is the whole point: an
 * instant at 23:30 UTC on the 8th is the 9th for someone two hours ahead, and
 * only local getters say so. Formatting with `toISOString()` would label it the
 * 8th and misplace every late-evening completion by a day.
 */
const localDayKey = (isoInstant) => {
    const d = new Date(isoInstant);
    if (Number.isNaN(d.getTime()))
        return null;
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
const getCompletionTrend = async (workspaceId, days, now = new Date()) => {
    const windows = (0, exports.localDayWindows)(now, days);
    const from = windows[0]?.start ?? iso(now);
    const empty = windows.map((window) => {
        const start = new Date(window.start);
        return {
            day: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
            completed: 0
        };
    });
    const { data, error } = await (0, client_1.db)()
        .from("tasks")
        .select("completed_at")
        .eq("workspace_id", workspaceId)
        .eq("status", "done")
        .not("completed_at", "is", null)
        .gte("completed_at", from);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not read your completion history.");
    const byDay = new Map(empty.map((point) => [point.day, point]));
    for (const row of data ?? []) {
        const key = localDayKey(row.completed_at);
        const point = key ? byDay.get(key) : undefined;
        // A bucket outside the requested window is ignored rather than invented.
        if (point)
            point.completed += 1;
    }
    return empty;
};
exports.getCompletionTrend = getCompletionTrend;
/** Task counts by the user's own priority, for the detailed view. */
const getPriorityBreakdown = async (workspaceId) => {
    const { data, error } = await (0, client_1.db)()
        .from("tasks")
        .select("priority")
        .eq("workspace_id", workspaceId);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not read your priorities.");
    const order = { high: "High", medium: "Medium", low: "Low" };
    const counts = new Map();
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
exports.getPriorityBreakdown = getPriorityBreakdown;
/**
 * Task counts per category, plus an explicit bucket for uncategorised tasks.
 *
 * Reads the link table once and the category names once - two queries, not one
 * per task - which avoids the N+1 that resolving each task's category
 * individually would produce.
 */
const getCategoryBreakdown = async (workspaceId) => {
    const [{ data: links, error: linkError }, { data: tasks, error: taskError }] = await Promise.all([
        (0, client_1.db)().from("task_category_links").select("task_id, category_id").eq("workspace_id", workspaceId),
        (0, client_1.db)().from("tasks").select("id").eq("workspace_id", workspaceId)
    ]);
    if (linkError)
        throw (0, errors_1.toDataError)(linkError, "Could not read your categories.");
    if (taskError)
        throw (0, errors_1.toDataError)(taskError, "Could not read your tasks.");
    const { data: categories } = await (0, client_1.db)()
        .from("task_categories")
        .select("id, name")
        .eq("workspace_id", workspaceId);
    const names = new Map((categories ?? []).map((c) => [c.id, c.name]));
    const perTask = new Map();
    for (const link of links ?? []) {
        const list = perTask.get(link.task_id) ?? [];
        list.push(names.get(link.category_id) ?? "Untitled");
        perTask.set(link.task_id, list);
    }
    const counts = new Map();
    for (const task of tasks ?? []) {
        const labels = perTask.get(task.id);
        // A task can carry several categories. It is counted under each rather than
        // being split fractionally, so the counts answer "how many tasks touch this
        // category" - and the UI says so.
        if (!labels || labels.length === 0) {
            counts.set("Uncategorised", (counts.get("Uncategorised") ?? 0) + 1);
        }
        else {
            for (const label of new Set(labels)) {
                counts.set(label, (counts.get(label) ?? 0) + 1);
            }
        }
    }
    return [...counts.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
};
exports.getCategoryBreakdown = getCategoryBreakdown;
/** Everything the detailed analytics page needs, in one round of parallel reads. */
const getDetailedTaskAnalytics = async (workspaceId, now = new Date()) => {
    const [summary, trend, priorities, categories] = await Promise.all([
        (0, exports.getTaskAnalytics)(workspaceId, now),
        (0, exports.getCompletionTrend)(workspaceId, 30, now),
        (0, exports.getPriorityBreakdown)(workspaceId),
        (0, exports.getCategoryBreakdown)(workspaceId)
    ]);
    return { summary, trend, priorities, categories };
};
exports.getDetailedTaskAnalytics = getDetailedTaskAnalytics;
