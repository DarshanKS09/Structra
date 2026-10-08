import type { GroceryItemRow, HabitRow, NoteRow, RecordRow, StudySessionRow, StudySubjectRow, TaskRow } from "@/lib/data/types";
import { computeStreak, todayKey } from "@/lib/data/habits";
import { readDataField } from "@/lib/data/records";
import type {
  GroceryItem,
  HabitItem,
  ListItem,
  ListMode,
  MeetingItem,
  PriorityLevel,
  ShoppingItem,
  StudyItem,
  TaskItem,
  FitnessItem
} from "@/types/taskTypes";

/**
 * Translation between database rows and Structra's existing `ListItem` union.
 *
 * This is the seam that lets Supabase become the source of truth without
 * redesigning the UI. `ModeList`, `ItemCard`, `EmptyState` and `AddItemModal`
 * keep working against exactly the shapes they already expect; only this file
 * knows the database exists.
 *
 * Mapping of Structra's original concepts onto the schema:
 *
 *   TaskItem.completed      -> tasks.status = 'done'
 *   TaskItem.priority       -> tasks.priority        ('low' <-> 'Low')
 *   TaskItem.dueDate        -> tasks.due_at          (timestamptz, rendered
 *                                                          as a date string
 *                                                          for <input type=date>)
 *   HabitItem.streak        -> DERIVED from habit_completions, not stored
 *   StudyItem               -> one row in study_sessions
 *   FitnessItem             -> a record of the "Fitness" record type
 *   ShoppingItem            -> a record of the "Shopping" record type
 *   MeetingItem             -> a row in notes
 */

// ---------------------------------------------------------------------------
// Small format helpers
// ---------------------------------------------------------------------------

const toTitleCasePriority = (value: string): PriorityLevel => {
  const lower = value.toLowerCase();
  if (lower === "high") return "High";
  if (lower === "low") return "Low";
  return "Medium";
};

const toDbPriority = (value: PriorityLevel): "low" | "medium" | "high" =>
  value === "High" ? "high" : value === "Low" ? "low" : "medium";

/** `YYYY-MM-DD` in local time, which is what `<input type="date">` expects. */
export const toDateInputValue = (iso: string | null): string => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/** Local midnight as an ISO instant, so a picked date is not shifted by timezone. */
export const fromDateInputValue = (value: string): string | null => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/**
 * `YYYY-MM-DDTHH:mm` in LOCAL time, which is what
 * `<input type="datetime-local">` expects.
 *
 * Deliberately built from local getters rather than `toISOString()`: the input
 * shows the user their own wall-clock time, so a deadline picked as 09:00 must
 * round-trip as 09:00 for them. `toISOString()` would convert to UTC and shift
 * the displayed time by the offset.
 */
export const toDateTimeInputValue = (iso: string | null): string => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/**
 * A `<input type="datetime-local">` value as an ISO instant.
 *
 * The parsed string carries no zone, so it is interpreted in local time and then
 * converted to the absolute instant `tasks.due_at` stores. That keeps a single
 * source of truth: the database holds a real timestamp, so every comparison
 * (overdue, due today, reminder scheduling) is exact.
 *
 * A bare date is accepted too, so a legacy `"YYYY-MM-DD"` value still converts
 * rather than becoming invalid.
 */
export const fromDateTimeInputValue = (value: string): string | null => {
  if (!value) return null;
  const withTime = value.length === 10 ? `${value}T00:00` : value;
  const date = new Date(withTime);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** A short human deadline, e.g. `"8 Oct, 14:30"`, or `""` when there is none. */
export const formatDeadline = (iso: string | null): string => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${date.getDate()} ${months[date.getMonth()]}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** `3720` -> `"1h 2m"`, `1800` -> `"30 min"`. */
export const formatDuration = (seconds: number | null): string => {
  if (seconds === null || seconds <= 0) return "0 min";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
};

/** Seconds elapsed since an instant, for a running session. */
export const elapsedSince = (startedAt: string, now: number = Date.now()): number =>
  Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));

// ---------------------------------------------------------------------------
// Row -> ListItem
// ---------------------------------------------------------------------------

export const taskRowToItem = (row: TaskRow): TaskItem => ({
  id: row.id,
  mode: "task",
  title: row.title,
  description: row.description ?? "",
  priority: toTitleCasePriority(row.priority),
  // The FULL instant, not a truncated date. `due_at` is timestamptz, and every
  // comparison downstream (overdue, due today, reminder scheduling) needs the
  // time of day, not just the calendar date. The form converts to and from
  // `datetime-local` at the edges.
  dueDate: row.due_at ?? "",
  reminderOffsetMinutes: row.reminder_offset_minutes ?? null,
  completed: row.status === "done",
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export const groceryRowToItem = (row: GroceryItemRow): GroceryItem => ({
  id: row.id,
  mode: "grocery",
  itemName: row.name,
  quantity: Number(row.quantity ?? 0),
  unit: row.unit ?? "pieces",
  purchased: row.completed,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export const habitRowToItem = (
  row: HabitRow,
  stats: { completedToday: boolean; currentStreak: number }
): HabitItem => ({
  id: row.id,
  mode: "habit",
  habitName: row.name,
  frequency: row.frequency === "weekly" ? "Weekly" : "Daily",
  streak: stats.currentStreak,
  completed: stats.completedToday,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export type StudyContext = {
  /** Subject id -> subject name, so sessions can show a readable subject. */
  subjectNames: Map<string, string>;
  now?: number;
};

export const studyRowToItem = (row: StudySessionRow, context: StudyContext): StudyItem => {
  const running = row.ended_at === null;
  const seconds = running
    ? elapsedSince(row.started_at, context.now ?? Date.now())
    : (row.duration_seconds ?? 0);

  return {
    id: row.id,
    mode: "study",
    subject: (row.subject_id && context.subjectNames.get(row.subject_id)) || "Study",
    topic: row.topic ?? (running ? "In progress" : ""),
    estimatedStudyTime: formatDuration(seconds),
    completed: !running,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
};

/** Fitness is a record of the built-in "Fitness" record type. */
export const fitnessRowToItem = (row: RecordRow): FitnessItem => ({
  id: row.id,
  mode: "fitness",
  exerciseName: row.title,
  sets: Number(readDataField<number>(row, "sets", 0)),
  reps: Number(readDataField<number>(row, "reps", 0)),
  duration: String(readDataField<string>(row, "duration", "")),
  completed: Boolean(readDataField<boolean>(row, "completed", false)),
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

/** Shopping is a record of the built-in "Shopping" record type. */
export const shoppingRowToItem = (row: RecordRow): ShoppingItem => ({
  id: row.id,
  mode: "shopping",
  itemName: row.title,
  price: Number(readDataField<number>(row, "price", 0)),
  priority: toTitleCasePriority(String(readDataField<string>(row, "priority", "medium"))),
  purchased: Boolean(readDataField<boolean>(row, "purchased", false)),
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

/** Meeting Notes mode is backed by `notes`. */
export const noteRowToItem = (row: NoteRow): MeetingItem => ({
  id: row.id,
  mode: "meeting",
  meetingTitle: row.title,
  // Participants are not modelled yet - see the notes migration notes.
  participants: "",
  date: toDateInputValue(row.created_at),
  notes: row.content ?? "",
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

// ---------------------------------------------------------------------------
// ListItem -> draft (for the AddItemModal submit path)
// ---------------------------------------------------------------------------

export type ModeDrafts = {
  task: (item: TaskItem) => {
    title: string;
    description: string | null;
    priority: "low" | "medium" | "high";
    due_at: string | null;
  };
  grocery: (item: GroceryItem) => { name: string; quantity: number | null; unit: "kg" | "g" | "pieces" | "liters" | null };
  habit: (item: HabitItem) => { name: string; frequency: "daily" | "weekly" };
  study: (item: StudyItem) => { topic: string; subject: string };
  fitness: (item: FitnessItem) => Record<string, unknown>;
  shopping: (item: ShoppingItem) => Record<string, unknown>;
  meeting: (item: MeetingItem) => { title: string; content: string };
};

export const toTaskDraft: ModeDrafts["task"] = (item) => ({
  title: item.title,
  // The UI union types description as a plain string, while the column is
  // nullable. An empty string is normalised to NULL so "no description" is
  // stored as SQL NULL rather than an empty string.
  description: item.description || null,
  priority: toDbPriority(item.priority),
  // The item already holds an ISO instant (see `taskRowToItem`), so it is
  // passed through rather than re-parsed. `fromDateTimeInputValue` also accepts
  // a bare `YYYY-MM-DD`, which keeps a legacy date-only value writable.
  due_at: fromDateTimeInputValue(item.dueDate),
  // `REMINDER.NONE` is 0, so a plain `?? null` would let a 0 through - and the
  // column's CHECK constraint starts at 1, so 0 would be rejected as an invalid
  // reminder rather than meaning "no reminder". Normalising here keeps the
  // sentinel and the database in agreement.
  reminder_offset_minutes:
    !item.reminderOffsetMinutes || item.reminderOffsetMinutes < 1
      ? null
      : item.reminderOffsetMinutes
});

export const toGroceryDraft: ModeDrafts["grocery"] = (item) => ({
  name: item.itemName,
  quantity: item.quantity > 0 ? item.quantity : null,
  // The UI union always carries a unit; the database column is nullable and is
  // only written when a quantity exists, so the pair stays consistent.
  unit: item.quantity > 0 ? item.unit : "pieces"
});

export const toHabitDraft: ModeDrafts["habit"] = (item) => ({
  name: item.habitName,
  frequency: item.frequency === "Weekly" ? "weekly" : "daily"
});

export const toFitnessDraft: ModeDrafts["fitness"] = (item) => ({
  sets: item.sets,
  reps: item.reps,
  duration: item.duration,
  completed: item.completed
});

export const toShoppingDraft: ModeDrafts["shopping"] = (item) => ({
  price: item.price,
  priority: toDbPriority(item.priority),
  purchased: item.purchased
});

export const toNoteDraft: ModeDrafts["meeting"] = (item) => ({
  title: item.meetingTitle,
  content: item.notes || ""
});

/** Session notes for the study mode, where the UI has no free-text field yet. */
export const toStudyDraft: ModeDrafts["study"] = (item) => ({
  subject: item.subject || "Study",
  topic: item.topic || ""
});

// ---------------------------------------------------------------------------
// Completion helpers shared by hooks
// ---------------------------------------------------------------------------

/** Whether an item counts as complete, matching the UI's `isCompleted` logic. */
export const isItemCompleted = (item: ListItem): boolean => {
  if ("completed" in item) return item.completed;
  if ("purchased" in item) return item.purchased;
  return false;
};

/** Convenience re-export so callers need not import from the habits module. */
export { computeStreak, todayKey };
export type { StudySubjectRow };