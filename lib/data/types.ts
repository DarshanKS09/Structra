import type { Database, Tables, TablesInsert, TablesUpdate } from "@/lib/supabase/types";

/**
 * Row-level aliases for every table in the schema.
 *
 * Using these instead of repeating `Tables<"tasks">` keeps call sites short and
 * means a schema change surfaces in one place.
 */
export type ProfileRow = Tables<"profiles">;
export type WorkspaceRow = Tables<"workspaces">;
export type WorkspaceMemberRow = Tables<"workspace_members">;
export type UserSettingsRow = Tables<"user_settings">;

export type TaskRow = Tables<"tasks">;
export type TaskCategoryRow = Tables<"task_categories">;

export type HabitRow = Tables<"habits">;
export type HabitCompletionRow = Tables<"habit_completions">;

export type StudySubjectRow = Tables<"study_subjects">;
export type StudySessionRow = Tables<"study_sessions">;

export type RecordRow = Tables<"records">;
export type RecordTypeRow = Tables<"record_types">;
export type RecordCategoryRow = Tables<"record_categories">;

export type GroceryListRow = Tables<"grocery_lists">;
export type GroceryItemRow = Tables<"grocery_items">;

export type NoteRow = Tables<"notes">;
export type TaskNotificationRow = Tables<"task_notifications">;

/** Insert shapes. */
export type ProfileInsert = TablesInsert<"profiles">;
export type UserSettingsInsert = TablesInsert<"user_settings">;
export type TaskInsert = TablesInsert<"tasks">;
export type TaskCategoryInsert = TablesInsert<"task_categories">;
export type HabitInsert = TablesInsert<"habits">;
export type HabitCompletionInsert = TablesInsert<"habit_completions">;
export type StudySubjectInsert = TablesInsert<"study_subjects">;
export type StudySessionInsert = TablesInsert<"study_sessions">;
export type RecordInsert = TablesInsert<"records">;
export type RecordTypeInsert = TablesInsert<"record_types">;
export type RecordCategoryInsert = TablesInsert<"record_categories">;
export type GroceryListInsert = TablesInsert<"grocery_lists">;
export type GroceryItemInsert = TablesInsert<"grocery_items">;
export type NoteInsert = TablesInsert<"notes">;

/** Update shapes - every column is optional. */
export type ProfileUpdate = TablesUpdate<"profiles">;
export type UserSettingsUpdate = TablesUpdate<"user_settings">;
export type TaskUpdate = TablesUpdate<"tasks">;
export type HabitUpdate = TablesUpdate<"habits">;
export type StudySessionUpdate = TablesUpdate<"study_sessions">;
export type RecordUpdate = TablesUpdate<"records">;
export type GroceryListUpdate = TablesUpdate<"grocery_lists">;
export type GroceryItemUpdate = TablesUpdate<"grocery_items">;
export type NoteUpdate = TablesUpdate<"notes">;

/** Enumerated domains, re-exported so UI code imports from one place. */
export type TaskStatus = Database["public"]["Enums"]["task_status"];
export type TaskPriority = Database["public"]["Enums"]["task_priority"];
export type WorkspaceRole = Database["public"]["Enums"]["workspace_role"];
export type GroceryUnit = Database["public"]["Enums"]["grocery_unit"];
export type HabitFrequency = Database["public"]["Enums"]["habit_frequency"];
export type AppTheme = Database["public"]["Enums"]["app_theme"];

/** A workspace plus the caller's role in it - what the app actually needs. */
export type WorkspaceWithRole = WorkspaceRow & { role: WorkspaceRole };

/** Generic async state used by the data hooks. */
export type AsyncStatus = "idle" | "loading" | "success" | "error";