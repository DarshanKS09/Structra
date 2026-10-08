"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteHabit = exports.archiveHabit = exports.listHabitCompletions = exports.clearHabitCompletion = exports.setHabitCompleted = exports.updateHabit = exports.createHabit = exports.computeStreak = exports.listHabits = exports.todayKey = exports.toLocalDateKey = void 0;
const client_1 = require("./stub-client.js");
const errors_1 = require("./stub-errors.js");
/**
 * Habits and their completion log.
 *
 * A streak is never stored. It is derived from `habit_completions`, replacing
 * the previous behaviour where `streak` was a number the user typed into a form
 * and nothing ever incremented.
 */
/** Local calendar day as `YYYY-MM-DD`, which is what `completed_on` stores. */
const toLocalDateKey = (date) => {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
};
exports.toLocalDateKey = toLocalDateKey;
const todayKey = () => (0, exports.toLocalDateKey)(new Date());
exports.todayKey = todayKey;
const listHabits = async (workspaceId, userId, options = {}) => {
    const { includeArchived = false } = options;
    let query = (0, client_1.db)().from("habits").select("*").eq("workspace_id", workspaceId);
    if (!includeArchived)
        query = query.is("archived_at", null);
    const { data: habits, error } = await query.order("created_at", { ascending: false });
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not load your habits.");
    const list = habits ?? [];
    if (list.length === 0)
        return [];
    // One query for every habit's completions, rather than one per habit.
    const { data: completions, error: completionError } = await (0, client_1.db)()
        .from("habit_completions")
        .select("habit_id, completed_on")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId);
    if (completionError)
        throw (0, errors_1.toDataError)(completionError, "Could not load habit history.");
    const byHabit = new Map();
    for (const row of completions ?? []) {
        const listForHabit = byHabit.get(row.habit_id) ?? [];
        listForHabit.push(row.completed_on);
        byHabit.set(row.habit_id, listForHabit);
    }
    const today = (0, exports.todayKey)();
    return list.map((habit) => {
        const days = new Set(byHabit.get(habit.id) ?? []);
        return {
            habit,
            completedToday: days.has(today),
            currentStreak: (0, exports.computeStreak)(days, today)
        };
    });
};
exports.listHabits = listHabits;
/**
 * Consecutive-day streak ending today or yesterday.
 *
 * A streak survives a missed *current* day until yesterday, which is the
 * conventional behaviour: it only breaks once a whole day is missed.
 */
const computeStreak = (completionDays, today) => {
    if (completionDays.size === 0)
        return 0;
    const cursor = new Date(`${today}T00:00:00`);
    if (!completionDays.has(today)) {
        cursor.setDate(cursor.getDate() - 1);
        if (!completionDays.has((0, exports.toLocalDateKey)(cursor)))
            return 0;
    }
    let streak = 0;
    // Bounded by the number of recorded days: a corrupt future date in the log
    // must not cause an unbounded loop.
    const limit = completionDays.size + 2;
    while (streak < limit) {
        if (!completionDays.has((0, exports.toLocalDateKey)(cursor)))
            break;
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
};
exports.computeStreak = computeStreak;
const createHabit = async (workspaceId, createdBy, input) => {
    if (!input.name?.trim())
        throw (0, errors_1.validationError)("A habit needs a name.");
    const { data, error } = await (0, client_1.db)()
        .from("habits")
        .insert({
        workspace_id: workspaceId,
        created_by: createdBy,
        name: input.name.trim(),
        description: input.description ?? null,
        frequency: input.frequency ?? "daily"
    })
        .select("*")
        .single();
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not create the habit.");
    return data;
};
exports.createHabit = createHabit;
const updateHabit = async (workspaceId, habitId, patch) => {
    const { data, error } = await (0, client_1.db)()
        .from("habits")
        .update(patch)
        .eq("workspace_id", workspaceId)
        .eq("id", habitId)
        .select("*")
        .single();
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not update the habit.");
    return data;
};
exports.updateHabit = updateHabit;
/**
 * Records completion for a day.
 *
 * `upsert ... onConflict: habit_id,completed_on` makes this idempotent, so a
 * double-tap or a retried request cannot inflate a streak. The unique
 * constraint in the schema is the real guarantee.
 */
const setHabitCompleted = async (workspaceId, userId, habitId, completedOn, completed) => {
    if (completed) {
        const { error } = await (0, client_1.db)().from("habit_completions").upsert({ workspace_id: workspaceId, habit_id: habitId, user_id: userId, completed_on: completedOn }, { onConflict: "habit_id,completed_on", ignoreDuplicates: true });
        if (error)
            throw (0, errors_1.toDataError)(error, "Could not record the habit.");
        return;
    }
    const { error } = await (0, client_1.db)()
        .from("habit_completions")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("habit_id", habitId)
        .eq("user_id", userId)
        .eq("completed_on", completedOn);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not update the habit.");
};
exports.setHabitCompleted = setHabitCompleted;
const clearHabitCompletion = async (workspaceId, userId, habitId, completedOn) => {
    const { error } = await (0, client_1.db)()
        .from("habit_completions")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("habit_id", habitId)
        .eq("user_id", userId)
        .eq("completed_on", completedOn);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not clear the habit completion.");
};
exports.clearHabitCompletion = clearHabitCompletion;
const listHabitCompletions = async (workspaceId, habitId, limit = 60) => {
    const { data, error } = await (0, client_1.db)()
        .from("habit_completions")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("habit_id", habitId)
        .order("completed_on", { ascending: false })
        .limit(limit);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not load habit history.");
    return data ?? [];
};
exports.listHabitCompletions = listHabitCompletions;
/**
 * Soft delete, so completion history survives.
 *
 * Clamped against `created_at` for the same clock-skew reason as `archiveNote`.
 */
const archiveHabit = async (workspaceId, habitId) => {
    const at = await (0, client_1.safeArchiveTimestamp)(async () => {
        const { data } = await (0, client_1.db)()
            .from("habits")
            .select("created_at")
            .eq("workspace_id", workspaceId)
            .eq("id", habitId)
            .maybeSingle();
        return data?.created_at ?? null;
    });
    const { error } = await (0, client_1.db)()
        .from("habits")
        .update({ archived_at: at })
        .eq("workspace_id", workspaceId)
        .eq("id", habitId);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not archive the habit.");
};
exports.archiveHabit = archiveHabit;
const deleteHabit = async (workspaceId, habitId) => {
    const { error } = await (0, client_1.db)()
        .from("habits")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("id", habitId);
    if (error)
        throw (0, errors_1.toDataError)(error, "Could not delete the habit.");
};
exports.deleteHabit = deleteHabit;
