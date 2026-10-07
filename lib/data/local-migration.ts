import type {
  ListItem,
  TaskItem,
  GroceryItem,
  HabitItem,
  StudyItem,
  FitnessItem,
  ShoppingItem,
  MeetingItem
} from "@/types/taskTypes";
import { db } from "@/lib/data/client";
import { DataError, toDataError } from "@/lib/data/errors";
import { fromDateInputValue } from "@/lib/data/adapters";
import { createTask } from "@/lib/data/tasks";
import { createHabit, setHabitCompleted, todayKey } from "@/lib/data/habits";
import { createStudySubject, startStudySession, stopStudySession } from "@/lib/data/study";
import { createRecord, ensureRecordType, BUILT_IN_RECORD_TYPES } from "@/lib/data/records";
import { ensureDefaultGroceryList, createGroceryItem, updateGroceryItem } from "@/lib/data/groceries";
import { createNote } from "@/lib/data/notes";
import type { Json } from "@/lib/supabase/types";

/**
 * One-way import of pre-Supabase localStorage data.
 *
 * ---------------------------------------------------------------------------
 * DESIGN RULES
 * ---------------------------------------------------------------------------
 *
 * 1. NOTHING IS DELETED. The original payload is copied to a backup key before
 *    anything else happens, and the backup is only cleared if the user
 *    explicitly discards it. A failed import therefore leaves the data exactly
 *    where it was.
 *
 * 2. The import is CONTROLLED. It never runs automatically on page load. The UI
 *    shows what is waiting to be imported and the user chooses, because a
 *    silent bulk insert into someone's account is not something to do behind
 *    their back.
 *
 * 3. The import is IDEMPOTENT. A marker key records completion, so a second run
 *    cannot duplicate rows. Without this, a retry after a partial failure would
 *    double every imported item.
 *
 * ---------------------------------------------------------------------------
 * LOCALSTORAGE SEPARATION
 * ---------------------------------------------------------------------------
 *
 *   user-owned application data -> imported here, then removed from active use
 *   UI preferences               -> stay local
 *
 * `selectedMode` and `theme` are preferences, not user data, so they remain in
 * localStorage (the theme is additionally synced to `user_settings` so it can
 * later be applied during server rendering). `itemsByMode` is user data and is
 * what this module moves to PostgreSQL.
 */

export const LEGACY_STORAGE_KEY = "futuristic-task-manager-v1";
export const BACKUP_STORAGE_KEY = "structra-legacy-backup-v1";
export const MIGRATION_MARKER_KEY = "structra-migration-v1";

/**
 * Legacy items keyed by mode, each with its concrete type.
 *
 * Typing this per mode is what allows `item.title` and `item.itemName` to
 * narrow correctly. The old persisted payload really was heterogeneous, so an
 * untyped `ListItem[]` here would fail to compile on every field access.
 */
type LegacyItemsMap = Partial<{
  task: TaskItem[];
  grocery: GroceryItem[];
  habit: HabitItem[];
  study: StudyItem[];
  fitness: FitnessItem[];
  shopping: ShoppingItem[];
  meeting: MeetingItem[];
}>;

type LegacyPersistedState = {
  state?: {
    itemsByMode?: LegacyItemsMap;
    selectedMode?: string | null;
    theme?: string;
  };
  version?: number;
};

export type LegacySnapshot = {
  exists: boolean;
  /** Total items across all modes. */
  totalItems: number;
  /** Per-mode counts, for the confirmation prompt. */
  countsByMode: Record<string, number>;
  hasBackup: boolean;
  /** True once an import has completed successfully. */
  alreadyMigrated: boolean;
  corrupt: boolean;
};

const isBrowser = (): boolean => typeof window !== "undefined";

const readJson = (key: string): unknown => {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    // Corrupt JSON must not crash the app; it is reported as `corrupt`.
    return null;
  }
};

const writeJson = (key: string, value: unknown): void => {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or privacy-mode failure. Never fatal: the source data is untouched.
  }
};

/** Inspects legacy storage without modifying anything. */
export const inspectLegacyData = (): LegacySnapshot => {
  const empty: LegacySnapshot = {
    exists: false,
    totalItems: 0,
    countsByMode: {},
    hasBackup: false,
    alreadyMigrated: false,
    corrupt: false
  };
  if (!isBrowser()) return empty;

  const hasBackup = window.localStorage.getItem(BACKUP_STORAGE_KEY) !== null;
  const marker = readJson(MIGRATION_MARKER_KEY) as { completedAt?: string } | null;
  const alreadyMigrated = Boolean(marker?.completedAt);

  const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  if (raw === null) return { ...empty, hasBackup, alreadyMigrated };

  let parsed: LegacyPersistedState | null;
  try {
    parsed = JSON.parse(raw) as LegacyPersistedState;
  } catch {
    return { ...empty, hasBackup, alreadyMigrated, exists: true, corrupt: true };
  }

  const itemsByMode = parsed?.state?.itemsByMode ?? {};
  const countsByMode: Record<string, number> = {};
  let totalItems = 0;
  for (const [mode, items] of Object.entries(itemsByMode)) {
    const count = Array.isArray(items) ? items.length : 0;
    if (count > 0) countsByMode[mode] = count;
    totalItems += count;
  }

  return {
    exists: true,
    totalItems,
    countsByMode,
    hasBackup,
    alreadyMigrated,
    corrupt: false
  };
};

/** Copies the legacy payload to the backup key. Returns true on success. */
const backupLegacyData = (): boolean => {
  if (!isBrowser()) return false;
  const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  if (raw === null) return false;
  try {
    window.localStorage.setItem(BACKUP_STORAGE_KEY, raw);
    return true;
  } catch {
    return false;
  }
};

export type MigrationProgress = {
  imported: number;
  failed: number;
  /** Per-mode failures, surfaced so the user is not told "all good" falsely. */
  errors: string[];
};

export type MigrationResult = {
  ok: boolean;
  progress: MigrationProgress;
  error: DataError | null;
};

/**
 * `"45 min"` / `"1h 20m"` / `"90s"` / `"90"` -> seconds.
 *
 * Returns null when the text cannot be parsed, so the caller can leave
 * `ended_at` null rather than invent a duration. A bare number is read as
 * minutes, which is what the app's placeholder suggested.
 */
export const parseDurationToSeconds = (text: string): number | null => {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return null;

  // Seconds are matched first: otherwise the minutes pattern would match the
  // "m" inside an unrelated word, and a bare "90s" would fall through.
  const hours = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)/.exec(trimmed);
  const minutes = /(\d+(?:\.\d+)?)\s*(?:m|in|ins|min|mins|minute|minutes)\b/.exec(trimmed);
  const seconds = /(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/.exec(trimmed);

  if (hours || minutes || seconds) {
    return Math.round(
      (hours ? Number(hours[1]) * 3600 : 0) +
      (minutes ? Number(minutes[1]) * 60 : 0) +
      (seconds ? Number(seconds[1]) : 0)
    );
  }

  const bare = /^(\d+(?:\.\d+)?)$/.exec(trimmed);
  if (bare) return Math.round(Number(bare[1]) * 60);

  return null;
};

const priorityToDb = (value: string): "low" | "medium" | "high" =>
  value === "High" ? "high" : value === "Low" ? "low" : "medium";

/**
 * Imports every legacy item into the database for `workspaceId`.
 *
 * Items are imported one at a time and failures are counted rather than
 * aborting: one malformed row should not cost the user the other 200 items.
 */
export const migrateLegacyData = async (workspaceId: string, userId: string): Promise<MigrationResult> => {
  const progress: MigrationProgress = { imported: 0, failed: 0, errors: [] };

  if (!isBrowser()) {
    return {
      ok: false,
      progress,
      error: new DataError("VALIDATION", "The import can only run in a browser.")
    };
  }

  const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  if (raw === null) {
    return { ok: true, progress, error: null };
  }

  let parsed: LegacyPersistedState | null;
  try {
    parsed = JSON.parse(raw) as LegacyPersistedState;
  } catch (caught) {
    return {
      ok: false,
      progress,
      error: toDataError(caught, "The saved local data could not be read.")
    };
  }

  // Back up BEFORE writing anything to the database.
  if (!backupLegacyData()) {
    return {
      ok: false,
      progress,
      error: new DataError("VALIDATION", "Could not back up your local data, so nothing was imported.")
    };
  }

  const itemsByMode = parsed?.state?.itemsByMode ?? {};

  /** Records a failure without aborting: one bad row must not lose the rest. */
  const fail = (mode: string, label: string) => {
    progress.failed += 1;
    if (progress.errors.length < 10) {
      progress.errors.push(`${mode}: ${String(label).slice(0, 40)}`);
    }
  };

  try {
    // ---- tasks
    for (const item of itemsByMode.task ?? []) {
      try {
        await createTask(workspaceId, userId, {
          title: item.title,
          description: item.description || null,
          priority: priorityToDb(item.priority),
          due_at: fromDateInputValue(item.dueDate),
          status: item.completed ? "done" : "todo"
        });
        progress.imported += 1;
      } catch {
        fail("task", item.title);
      }
    }

    // ---- groceries (into the default list)
    const groceries = itemsByMode.grocery ?? [];
    if (groceries.length > 0) {
      const list = await ensureDefaultGroceryList(workspaceId);
      for (const item of groceries) {
        try {
          const created = await createGroceryItem(list.id, {
            name: item.itemName,
            quantity: item.quantity > 0 ? item.quantity : null,
            unit: item.quantity > 0 ? item.unit : null
          });
          if (item.purchased) {
            await updateGroceryItem(list.id, created.id, { completed: true });
          }
          progress.imported += 1;
        } catch {
          fail("grocery", item.itemName);
        }
      }
    }

    // ---- habits
    // The old `streak` number is deliberately NOT imported: streaks are now
    // derived from real completion history, and copying a typed-in number would
    // seed a streak that never happened. A habit marked completed today gets a
    // real completion row instead.
    for (const item of itemsByMode.habit ?? []) {
      try {
        const habit = await createHabit(workspaceId, userId, {
          name: item.habitName,
          frequency: item.frequency === "Weekly" ? "weekly" : "daily"
        });
        if (item.completed) {
          await setHabitCompleted(workspaceId, userId, habit.id, todayKey(), true);
        }
        progress.imported += 1;
      } catch {
        fail("habit", item.habitName);
      }
    }

    // ---- study sessions
    // The old `estimatedStudyTime` was a typed string; it becomes the recorded
    // duration of a finished session when it parses.
    for (const item of itemsByMode.study ?? []) {
      try {
        const subject = await createStudySubject(workspaceId, { name: item.subject || "Study" });
        const seconds = parseDurationToSeconds(item.estimatedStudyTime);
        const startedAt = new Date(Date.now() - (seconds ?? 0) * 1000).toISOString();

        const session = await startStudySession(workspaceId, userId, {
          subjectId: subject.id,
          topic: item.topic || null,
          startedAt
        });

        if (seconds && seconds > 0) {
          await stopStudySession(workspaceId, session.id, new Date().toISOString());
        }
        progress.imported += 1;
      } catch {
        fail("study", item.subject);
      }
    }

    // ---- notes / meetings
    for (const item of itemsByMode.meeting ?? []) {
      try {
        await createNote(workspaceId, userId, {
          title: item.meetingTitle,
          content: item.notes || null
        });
        progress.imported += 1;
      } catch {
        fail("meeting", item.meetingTitle);
      }
    }

    // ---- fitness (records of the built-in type)
    const fitness = itemsByMode.fitness ?? [];
    if (fitness.length > 0) {
      try {
        const type = await ensureRecordType(workspaceId, userId, BUILT_IN_RECORD_TYPES.fitness);
        for (const item of fitness) {
          try {
            await createRecord(workspaceId, userId, {
              recordTypeId: type.id,
              title: item.exerciseName,
              data: {
                sets: item.sets,
                reps: item.reps,
                duration: item.duration,
                completed: item.completed
              }
            });
            progress.imported += 1;
          } catch {
            fail("fitness", item.exerciseName);
          }
        }
      } catch (caught) {
        progress.failed += fitness.length;
        progress.errors.push("fitness: type unavailable");
        void caught;
      }
    }

    // ---- shopping (records of the built-in type)
    const shopping = itemsByMode.shopping ?? [];
    if (shopping.length > 0) {
      try {
        const type = await ensureRecordType(workspaceId, userId, BUILT_IN_RECORD_TYPES.shopping);
        for (const item of shopping) {
          try {
            await createRecord(workspaceId, userId, {
              recordTypeId: type.id,
              title: item.itemName,
              data: {
                price: item.price,
                priority: priorityToDb(item.priority),
                purchased: item.purchased
              }
            });
            progress.imported += 1;
          } catch {
            fail("shopping", item.itemName);
          }
        }
      } catch {
        progress.failed += shopping.length;
        progress.errors.push("shopping: type unavailable");
      }
    }
  } catch (caught) {
    return {
      ok: false,
      progress,
      error: toDataError(caught, "The import stopped early. Your local data is still backed up.")
    };
  }

  // Record completion so a later visit cannot re-import and duplicate.
  writeJson(MIGRATION_MARKER_KEY, {
    completedAt: new Date().toISOString(),
    imported: progress.imported,
    failed: progress.failed
  });

  return { ok: true, progress, error: null };
};

/**
 * Removes the legacy items payload but keeps preferences and the backup.
 *
 * Only ever called after a successful import, and never removes the backup key,
 * so the raw data remains recoverable until the user discards it explicitly.
 */
export const clearLegacyItems = (): void => {
  if (!isBrowser()) return;
  const parsed = readJson(LEGACY_STORAGE_KEY) as LegacyPersistedState | null;
  if (!parsed?.state) return;

  // Keep UI preferences, drop only the user-owned items.
  const next = {
    state: { selectedMode: parsed.state.selectedMode ?? null, theme: parsed.state.theme ?? "ocean" },
    version: parsed.version ?? 2
  };
  writeJson(LEGACY_STORAGE_KEY, next);
};

/** Explicitly discards the backup. Never called automatically. */
export const discardLegacyBackup = (): void => {
  if (!isBrowser()) return;
  window.localStorage.removeItem(BACKUP_STORAGE_KEY);
};