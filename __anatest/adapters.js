"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.todayKey = exports.computeStreak = exports.isItemCompleted = exports.toStudyDraft = exports.toNoteDraft = exports.toShoppingDraft = exports.toFitnessDraft = exports.toHabitDraft = exports.toGroceryDraft = exports.toTaskDraft = exports.noteRowToItem = exports.shoppingRowToItem = exports.fitnessRowToItem = exports.studyRowToItem = exports.habitRowToItem = exports.groceryRowToItem = exports.taskRowToItem = exports.elapsedSince = exports.formatDuration = exports.formatDeadline = exports.fromDateTimeInputValue = exports.toDateTimeInputValue = exports.fromDateInputValue = exports.toDateInputValue = void 0;
const habits_1 = require("./habits.js");
Object.defineProperty(exports, "computeStreak", { enumerable: true, get: function () { return habits_1.computeStreak; } });
Object.defineProperty(exports, "todayKey", { enumerable: true, get: function () { return habits_1.todayKey; } });
const records_1 = require("./records.js");
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
const toTitleCasePriority = (value) => {
    const lower = value.toLowerCase();
    if (lower === "high")
        return "High";
    if (lower === "low")
        return "Low";
    return "Medium";
};
const toDbPriority = (value) => value === "High" ? "high" : value === "Low" ? "low" : "medium";
/** `YYYY-MM-DD` in local time, which is what `<input type="date">` expects. */
const toDateInputValue = (iso) => {
    if (!iso)
        return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()))
        return "";
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
};
exports.toDateInputValue = toDateInputValue;
/** Local midnight as an ISO instant, so a picked date is not shifted by timezone. */
const fromDateInputValue = (value) => {
    if (!value)
        return null;
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
exports.fromDateInputValue = fromDateInputValue;
/**
 * `YYYY-MM-DDTHH:mm` in LOCAL time, which is what
 * `<input type="datetime-local">` expects.
 *
 * Deliberately built from local getters rather than `toISOString()`: the input
 * shows the user their own wall-clock time, so a deadline picked as 09:00 must
 * round-trip as 09:00 for them. `toISOString()` would convert to UTC and shift
 * the displayed time by the offset.
 */
const toDateTimeInputValue = (iso) => {
    if (!iso)
        return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()))
        return "";
    const pad = (n) => `${n}`.padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
exports.toDateTimeInputValue = toDateTimeInputValue;
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
const fromDateTimeInputValue = (value) => {
    if (!value)
        return null;
    const withTime = value.length === 10 ? `${value}T00:00` : value;
    const date = new Date(withTime);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
exports.fromDateTimeInputValue = fromDateTimeInputValue;
/** A short human deadline, e.g. `"8 Oct, 14:30"`, or `""` when there is none. */
const formatDeadline = (iso) => {
    if (!iso)
        return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()))
        return "";
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const pad = (n) => `${n}`.padStart(2, "0");
    return `${date.getDate()} ${months[date.getMonth()]}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
exports.formatDeadline = formatDeadline;
/** `3720` -> `"1h 2m"`, `1800` -> `"30 min"`. */
const formatDuration = (seconds) => {
    if (seconds === null || seconds <= 0)
        return "0 min";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    if (hours === 0)
        return `${minutes} min`;
    if (minutes === 0)
        return `${hours}h`;
    return `${hours}h ${minutes}m`;
};
exports.formatDuration = formatDuration;
/** Seconds elapsed since an instant, for a running session. */
const elapsedSince = (startedAt, now = Date.now()) => Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
exports.elapsedSince = elapsedSince;
// ---------------------------------------------------------------------------
// Row -> ListItem
// ---------------------------------------------------------------------------
const taskRowToItem = (row) => ({
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
exports.taskRowToItem = taskRowToItem;
const groceryRowToItem = (row) => ({
    id: row.id,
    mode: "grocery",
    itemName: row.name,
    quantity: Number(row.quantity ?? 0),
    unit: row.unit ?? "pieces",
    purchased: row.completed,
    createdAt: row.created_at,
    updatedAt: row.updated_at
});
exports.groceryRowToItem = groceryRowToItem;
const habitRowToItem = (row, stats) => ({
    id: row.id,
    mode: "habit",
    habitName: row.name,
    frequency: row.frequency === "weekly" ? "Weekly" : "Daily",
    streak: stats.currentStreak,
    completed: stats.completedToday,
    createdAt: row.created_at,
    updatedAt: row.updated_at
});
exports.habitRowToItem = habitRowToItem;
const studyRowToItem = (row, context) => {
    const running = row.ended_at === null;
    const seconds = running
        ? (0, exports.elapsedSince)(row.started_at, context.now ?? Date.now())
        : (row.duration_seconds ?? 0);
    return {
        id: row.id,
        mode: "study",
        subject: (row.subject_id && context.subjectNames.get(row.subject_id)) || "Study",
        topic: row.topic ?? (running ? "In progress" : ""),
        estimatedStudyTime: (0, exports.formatDuration)(seconds),
        completed: !running,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
};
exports.studyRowToItem = studyRowToItem;
/** Fitness is a record of the built-in "Fitness" record type. */
const fitnessRowToItem = (row) => ({
    id: row.id,
    mode: "fitness",
    exerciseName: row.title,
    sets: Number((0, records_1.readDataField)(row, "sets", 0)),
    reps: Number((0, records_1.readDataField)(row, "reps", 0)),
    duration: String((0, records_1.readDataField)(row, "duration", "")),
    completed: Boolean((0, records_1.readDataField)(row, "completed", false)),
    createdAt: row.created_at,
    updatedAt: row.updated_at
});
exports.fitnessRowToItem = fitnessRowToItem;
/** Shopping is a record of the built-in "Shopping" record type. */
const shoppingRowToItem = (row) => ({
    id: row.id,
    mode: "shopping",
    itemName: row.title,
    price: Number((0, records_1.readDataField)(row, "price", 0)),
    priority: toTitleCasePriority(String((0, records_1.readDataField)(row, "priority", "medium"))),
    purchased: Boolean((0, records_1.readDataField)(row, "purchased", false)),
    createdAt: row.created_at,
    updatedAt: row.updated_at
});
exports.shoppingRowToItem = shoppingRowToItem;
/** Meeting Notes mode is backed by `notes`. */
const noteRowToItem = (row) => ({
    id: row.id,
    mode: "meeting",
    meetingTitle: row.title,
    // Participants are not modelled yet - see the notes migration notes.
    participants: "",
    date: (0, exports.toDateInputValue)(row.created_at),
    notes: row.content ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
});
exports.noteRowToItem = noteRowToItem;
const toTaskDraft = (item) => ({
    title: item.title,
    // The UI union types description as a plain string, while the column is
    // nullable. An empty string is normalised to NULL so "no description" is
    // stored as SQL NULL rather than an empty string.
    description: item.description || null,
    priority: toDbPriority(item.priority),
    // The item already holds an ISO instant (see `taskRowToItem`), so it is
    // passed through rather than re-parsed. `fromDateTimeInputValue` also accepts
    // a bare `YYYY-MM-DD`, which keeps a legacy date-only value writable.
    due_at: (0, exports.fromDateTimeInputValue)(item.dueDate),
    reminder_offset_minutes: item.reminderOffsetMinutes ?? null
});
exports.toTaskDraft = toTaskDraft;
const toGroceryDraft = (item) => ({
    name: item.itemName,
    quantity: item.quantity > 0 ? item.quantity : null,
    // The UI union always carries a unit; the database column is nullable and is
    // only written when a quantity exists, so the pair stays consistent.
    unit: item.quantity > 0 ? item.unit : "pieces"
});
exports.toGroceryDraft = toGroceryDraft;
const toHabitDraft = (item) => ({
    name: item.habitName,
    frequency: item.frequency === "Weekly" ? "weekly" : "daily"
});
exports.toHabitDraft = toHabitDraft;
const toFitnessDraft = (item) => ({
    sets: item.sets,
    reps: item.reps,
    duration: item.duration,
    completed: item.completed
});
exports.toFitnessDraft = toFitnessDraft;
const toShoppingDraft = (item) => ({
    price: item.price,
    priority: toDbPriority(item.priority),
    purchased: item.purchased
});
exports.toShoppingDraft = toShoppingDraft;
const toNoteDraft = (item) => ({
    title: item.meetingTitle,
    content: item.notes || ""
});
exports.toNoteDraft = toNoteDraft;
/** Session notes for the study mode, where the UI has no free-text field yet. */
const toStudyDraft = (item) => ({
    subject: item.subject || "Study",
    topic: item.topic || ""
});
exports.toStudyDraft = toStudyDraft;
// ---------------------------------------------------------------------------
// Completion helpers shared by hooks
// ---------------------------------------------------------------------------
/** Whether an item counts as complete, matching the UI's `isCompleted` logic. */
const isItemCompleted = (item) => {
    if ("completed" in item)
        return item.completed;
    if ("purchased" in item)
        return item.purchased;
    return false;
};
exports.isItemCompleted = isItemCompleted;
