/**
 * Public surface of the data-access layer.
 *
 * UI code should import from `@/lib/data` rather than reaching into
 * individual modules. That keeps call sites stable as modules are reorganised
 * and makes it obvious that no React code belongs in this layer.
 *
 * Layering:
 *
 *   UI (pages/components)
 *     -> hooks            (@/lib/hooks)
 *       -> data access    (@/lib/data)      <- you are here
 *         -> Supabase     (@/lib/supabase)
 *           -> PostgreSQL + RLS
 */

// Errors
export {
  DataError,
  isDataError,
  toDataError,
  unwrap,
  validationError
} from "@/lib/data/errors";
export type { DataErrorCode } from "@/lib/data/errors";

// Client accessor
export { db, requireUserId } from "@/lib/data/client";

// Row / enum type aliases
export type {
  AppTheme,
  AsyncStatus,
  GroceryItemRow,
  GroceryListRow,
  GroceryUnit,
  HabitCompletionRow,
  HabitFrequency,
  HabitRow,
  HabitUpdate,
  NoteRow,
  ProfileRow,
  RecordCategoryRow,
  RecordRow,
  RecordTypeRow,
  StudySessionRow,
  StudySubjectRow,
  TaskCategoryRow,
  TaskPriority,
  TaskRow,
  TaskStatus,
  TaskUpdate,
  UserSettingsRow,
  WorkspaceMemberRow,
  WorkspaceRole,
  WorkspaceRow,
  WorkspaceWithRole
} from "@/lib/data/types";

// Account, profile, settings, workspaces
export {
  getProfile,
  updateProfile,
  getUserSettings,
  saveUserSettings,
  setTheme,
  listWorkspaces,
  getPersonalWorkspace,
  getWorkspace,
  listWorkspaceMembers,
  loadBootstrap
} from "@/lib/data/account";
export type { BootstrapResult, WorkspaceMemberSummary } from "@/lib/data/account";

// Tasks
export {
  listTasks,
  countTasks,
  createTask,
  updateTask,
  setTaskCompleted,
  deleteTask,
  listTaskCategories,
  createTaskCategory,
  deleteTaskCategory,
  listTaskCategoryLinks,
  setTaskCategories
} from "@/lib/data/tasks";
export type { ListTasksOptions, TaskCompletionFilter } from "@/lib/data/tasks";

// Habits
export {
  listHabits,
  createHabit,
  updateHabit,
  setHabitCompleted,
  clearHabitCompletion,
  listHabitCompletions,
  archiveHabit,
  deleteHabit,
  computeStreak,
  toLocalDateKey,
  todayKey
} from "@/lib/data/habits";
export type { HabitWithStats } from "@/lib/data/habits";

// Study
export {
  listStudySubjects,
  createStudySubject,
  findOrCreateStudySubject,
  deleteStudySubject,
  listStudySessions,
  getRunningSession,
  startStudySession,
  stopStudySession,
  updateStudySession,
  deleteStudySession,
  listStudyDailyTotals,
  sumStudySeconds
} from "@/lib/data/study";
export type { ListStudySessionsOptions, StudyDailyTotal } from "@/lib/data/study";

// Records (also backs Fitness and Shopping)
export {
  listRecordTypes,
  getRecordType,
  createRecordType,
  ensureRecordType,
  deleteRecordType,
  listRecordCategories,
  createRecordCategory,
  deleteRecordCategory,
  listRecords,
  getRecord,
  createRecord,
  updateRecord,
  updateRecordData,
  archiveRecord,
  deleteRecord,
  readDataField,
  withDataField,
  BUILT_IN_RECORD_TYPES
} from "@/lib/data/records";
export type { ListRecordsOptions, RecordFieldDefinition } from "@/lib/data/records";

// Groceries
export {
  listGroceryLists,
  createGroceryList,
  ensureDefaultGroceryList,
  renameGroceryList,
  deleteGroceryList,
  listGroceryItems,
  createGroceryItem,
  setGroceryItemCompleted,
  updateGroceryItem,
  clearCompletedGroceryItems,
  deleteGroceryItem,
  groupGroceryItemsByName,
  DEFAULT_LIST_NAME
} from "@/lib/data/groceries";
export type { ListGroceryItemsOptions } from "@/lib/data/groceries";

// Notes
export {
  listNotes,
  createNote,
  updateNote,
  archiveNote,
  deleteNote
} from "@/lib/data/notes";
export type { ListNotesOptions } from "@/lib/data/notes";

// Adapters (rows <-> the existing UI ListItem union)
export {
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
  fromDateInputValue,
  formatDuration,
  elapsedSince
} from "@/lib/data/adapters";
export type { StudyContext, ModeDrafts } from "@/lib/data/adapters";