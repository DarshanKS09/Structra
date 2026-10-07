import { db, safeArchiveTimestamp } from "@/lib/data/client";
import { toDataError, validationError } from "@/lib/data/errors";
import type {
  HabitCompletionRow,
  HabitFrequency,
  HabitInsert,
  HabitRow,
  HabitUpdate
} from "@/lib/data/types";

/**
 * Habits and their completion log.
 *
 * A streak is never stored. It is derived from `habit_completions`, replacing
 * the previous behaviour where `streak` was a number the user typed into a form
 * and nothing ever incremented.
 */

/** Local calendar day as `YYYY-MM-DD`, which is what `completed_on` stores. */
export const toLocalDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const todayKey = (): string => toLocalDateKey(new Date());

export type HabitWithStats = {
  habit: HabitRow;
  completedToday: boolean;
  currentStreak: number;
};

export const listHabits = async (
  workspaceId: string,
  userId: string,
  options: { includeArchived?: boolean } = {}
): Promise<HabitWithStats[]> => {
  const { includeArchived = false } = options;

  let query = db().from("habits").select("*").eq("workspace_id", workspaceId);
  if (!includeArchived) query = query.is("archived_at", null);

  const { data: habits, error } = await query.order("created_at", { ascending: false });
  if (error) throw toDataError(error, "Could not load your habits.");

  const list = habits ?? [];
  if (list.length === 0) return [];

  // One query for every habit's completions, rather than one per habit.
  const { data: completions, error: completionError } = await db()
    .from("habit_completions")
    .select("habit_id, completed_on")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);
  if (completionError) throw toDataError(completionError, "Could not load habit history.");

  const byHabit = new Map<string, string[]>();
  for (const row of completions ?? []) {
    const listForHabit = byHabit.get(row.habit_id) ?? [];
    listForHabit.push(row.completed_on);
    byHabit.set(row.habit_id, listForHabit);
  }

  const today = todayKey();

  return list.map((habit) => {
    const days = new Set(byHabit.get(habit.id) ?? []);
    return {
      habit,
      completedToday: days.has(today),
      currentStreak: computeStreak(days, today)
    };
  });
};

/**
 * Consecutive-day streak ending today or yesterday.
 *
 * A streak survives a missed *current* day until yesterday, which is the
 * conventional behaviour: it only breaks once a whole day is missed.
 */
export const computeStreak = (completionDays: Set<string>, today: string): number => {
  if (completionDays.size === 0) return 0;
  const cursor = new Date(`${today}T00:00:00`);
  if (!completionDays.has(today)) {
    cursor.setDate(cursor.getDate() - 1);
    if (!completionDays.has(toLocalDateKey(cursor))) return 0;
  }
  let streak = 0;
  // Bounded by the number of recorded days: a corrupt future date in the log
  // must not cause an unbounded loop.
  const limit = completionDays.size + 2;
  while (streak < limit) {
    if (!completionDays.has(toLocalDateKey(cursor))) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
};

export const createHabit = async (
  workspaceId: string,
  createdBy: string,
  input: { name: string; description?: string | null; frequency?: HabitFrequency }
): Promise<HabitRow> => {
  if (!input.name?.trim()) throw validationError("A habit needs a name.");

  const { data, error } = await db()
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
  if (error) throw toDataError(error, "Could not create the habit.");
  return data;
};

export const updateHabit = async (
  workspaceId: string,
  habitId: string,
  patch: HabitUpdate
): Promise<HabitRow> => {
  const { data, error } = await db()
    .from("habits")
    .update(patch)
    .eq("workspace_id", workspaceId)
    .eq("id", habitId)
    .select("*")
    .single();
  if (error) throw toDataError(error, "Could not update the habit.");
  return data;
};

/**
 * Records completion for a day.
 *
 * `upsert ... onConflict: habit_id,completed_on` makes this idempotent, so a
 * double-tap or a retried request cannot inflate a streak. The unique
 * constraint in the schema is the real guarantee.
 */
export const setHabitCompleted = async (
  workspaceId: string,
  userId: string,
  habitId: string,
  completedOn: string,
  completed: boolean
): Promise<void> => {
  if (completed) {
    const { error } = await db().from("habit_completions").upsert(
      { workspace_id: workspaceId, habit_id: habitId, user_id: userId, completed_on: completedOn },
      { onConflict: "habit_id,completed_on", ignoreDuplicates: true }
    );
    if (error) throw toDataError(error, "Could not record the habit.");
    return;
  }

  const { error } = await db()
    .from("habit_completions")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("habit_id", habitId)
    .eq("user_id", userId)
    .eq("completed_on", completedOn);
  if (error) throw toDataError(error, "Could not update the habit.");
};

export const clearHabitCompletion = async (
  workspaceId: string,
  userId: string,
  habitId: string,
  completedOn: string
): Promise<void> => {
  const { error } = await db()
    .from("habit_completions")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("habit_id", habitId)
    .eq("user_id", userId)
    .eq("completed_on", completedOn);
  if (error) throw toDataError(error, "Could not clear the habit completion.");
};

export const listHabitCompletions = async (
  workspaceId: string,
  habitId: string,
  limit = 60
): Promise<HabitCompletionRow[]> => {
  const { data, error } = await db()
    .from("habit_completions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("habit_id", habitId)
    .order("completed_on", { ascending: false })
    .limit(limit);
  if (error) throw toDataError(error, "Could not load habit history.");
  return data ?? [];
};

/**
 * Soft delete, so completion history survives.
 *
 * Clamped against `created_at` for the same clock-skew reason as `archiveNote`.
 */
export const archiveHabit = async (workspaceId: string, habitId: string): Promise<void> => {
  const at = await safeArchiveTimestamp(async () => {
    const { data } = await db()
      .from("habits")
      .select("created_at")
      .eq("workspace_id", workspaceId)
      .eq("id", habitId)
      .maybeSingle();
    return data?.created_at ?? null;
  });

  const { error } = await db()
    .from("habits")
    .update({ archived_at: at })
    .eq("workspace_id", workspaceId)
    .eq("id", habitId);
  if (error) throw toDataError(error, "Could not archive the habit.");
};

export const deleteHabit = async (workspaceId: string, habitId: string): Promise<void> => {
  const { error } = await db()
    .from("habits")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", habitId);
  if (error) throw toDataError(error, "Could not delete the habit.");
};

export type { HabitInsert };