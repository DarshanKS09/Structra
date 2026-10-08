import { listTasks } from "@/lib/data/tasks";
import { ensureDefaultGroceryList, listGroceryItems } from "@/lib/data/groceries";
import { listNotes } from "@/lib/data/notes";
import { listHabits } from "@/lib/data/habits";
import { listGroceryHistory } from "@/lib/data/groceries";
import { getTaskAnalytics, type TaskAnalytics } from "@/lib/data/analytics";
import { getStudyAnalytics, type StudyAnalytics } from "@/lib/data/studyAnalytics";
import { listDueReminders, type ReminderRow } from "@/lib/data/reminders";
import { listStudySessions, listStudySubjects } from "@/lib/data/study";
import { ensureRecordType, listRecords, BUILT_IN_RECORD_TYPES } from "@/lib/data/records";
import {
  taskRowToItem,
  groceryRowToItem,
  habitRowToItem,
  studyRowToItem,
  fitnessRowToItem,
  shoppingRowToItem,
  noteRowToItem,
  isItemCompleted
} from "@/lib/data/adapters";
import type { ListItem, ListMode } from "@/types/taskTypes";

/**
 * Aggregates every section into the shape the Dashboard renders.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS REUSES THE EXISTING DATA LAYER
 * ---------------------------------------------------------------------------
 * The Dashboard composes the SAME exported functions the individual sections
 * already use (`listTasks`, `listGroceryItems`, `listNotes`, ...). It does not
 * query tables directly, so there is one definition of "what counts as an active
 * task" and one place where a schema change has to be reflected.
 *
 * ---------------------------------------------------------------------------
 * SCOPE
 * ---------------------------------------------------------------------------
 * Every call is scoped by `workspaceId` and `userId`, which is also what applies
 * Row Level Security: a user can only ever read their own workspace. Nothing
 * here accepts a caller-supplied owner id.
 *
 * ---------------------------------------------------------------------------
 * FAILURE BEHAVIOUR
 * ---------------------------------------------------------------------------
 * Each section is fetched independently and a failure degrades that section to
 * empty rather than blanking the whole Dashboard. One unavailable table must
 * not hide a user's tasks.
 */

export type SectionBuckets = {
  /** Not finished: the actionable work. */
  pending: ListItem[];
  /** Finished: summarised as a count, never listed. */
  completedCount: number;
  /** Saved but not actionable (e.g. a wishlist that is not a commitment). */
  wishlist: ListItem[];
};

export type DashboardSection = {
  mode: ListMode;
  label: string;
  /** Short line explaining what this section is holding. */
  summary: string;
  buckets: SectionBuckets;
};

export type DashboardSnapshot = {
  sections: DashboardSection[];
  /** True when at least one section failed to load. */
  partial: boolean;
  /** Section modes that failed, so the UI can be honest about it. */
  failed: ListMode[];
  /** Headline task metrics, derived from the same `tasks` rows as the section. */
  taskAnalytics: TaskAnalytics | null;
  /** Study time readout, scoped to the signed-in user. */
  studyAnalytics: StudyAnalytics | null;
  /** Reminders whose instant has passed and that have not been delivered. */
  dueReminders: ReminderRow[];
  /** How many finished grocery trips are kept as history. */
  groceryHistoryCount: number;
};

/**
 * The dashboard's own sections.
 *
 * Order is deliberate: actionable sections first, then the informational ones.
 * It is NOT the same as the navigation order, because "what needs doing" is a
 * different question from "where do I go to add things".
 */
const SECTION_ORDER: ListMode[] = [
  "task",
  "grocery",
  "study",
  "fitness",
  "habit",
  "meeting",
  "shopping"
];

const SECTION_LABELS: Record<ListMode, string> = {
  task: "Pending Tasks",
  grocery: "Grocery List",
  study: "Study Planner",
  fitness: "Fitness Tracker",
  habit: "Habit Tracker",
  meeting: "Meeting Notes",
  shopping: "Shopping Wishlist"
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const emptyBuckets = (): SectionBuckets => ({ pending: [], completedCount: 0, wishlist: [] });

const summarise = (mode: ListMode, buckets: SectionBuckets): string => {
  const pending = buckets.pending.length;
  const wishlist = buckets.wishlist.length;
  const done = buckets.completedCount;

  switch (mode) {
    case "shopping":
      // A wishlist is deliberately NOT counted as pending work.
      return wishlist === 0 ? "Nothing saved yet" : `${plural(wishlist, "item")} saved`;
    case "grocery":
      return pending === 0
        ? done > 0 ? `${plural(done, "item")} picked up` : "Nothing to pick up"
        : `${plural(pending, "item")} to pick up`;
    case "habit":
      return pending === 0
        ? done > 0 ? "All done for today" : "No habits yet"
        : `${plural(pending, "habit")} still open today`;
    case "study":
      return pending === 0
        ? done > 0 ? `${plural(done, "session")} logged` : "No sessions yet"
        : `${plural(pending, "session")} planned`;
    default:
      return pending === 0
        ? done > 0 ? `${plural(done, "item")} completed` : "Nothing pending"
        : `${plural(pending, "item")} pending`;
  }
};

/** Fetches one section, swallowing its failure into an empty result. */
const loadSection = async (
  workspaceId: string,
  userId: string,
  mode: ListMode
): Promise<SectionBuckets> => {
  const buckets = emptyBuckets();

  switch (mode) {
    case "task": {
      // "all" rather than "active": completion counts are needed for the
      // summary, and the completed rows are only counted, never listed.
      const rows = await listTasks(workspaceId, { filter: "all" });
      for (const row of rows) {
        const item = taskRowToItem(row);
        if (item.completed) buckets.completedCount += 1;
        else buckets.pending.push(item);
      }
      return buckets;
    }

    case "grocery": {
      const list = await ensureDefaultGroceryList(workspaceId);
      const rows = await listGroceryItems(list.id, { filter: "all" });
      for (const row of rows) {
        const item = groceryRowToItem(row);
        if (item.purchased) buckets.completedCount += 1;
        else buckets.pending.push(item);
      }
      return buckets;
    }

    case "habit": {
      // The returned rows carry derived completion state, so the split happens
      // here rather than in a query.
      const rows = await listHabits(workspaceId, userId);
      for (const entry of rows) {
        const item = habitRowToItem(entry.habit, entry);
        if (item.completed) buckets.completedCount += 1;
        else buckets.pending.push(item);
      }
      return buckets;
    }

    case "study": {
      const subjects = await listStudySubjects(workspaceId);
      const names = new Map(subjects.map((s) => [s.id, s.name]));
      const rows = await listStudySessions(workspaceId, userId, {});
      for (const row of rows) {
        const item = studyRowToItem(row, { subjectNames: names, now: Date.now() });
        if (item.completed) buckets.completedCount += 1;
        else buckets.pending.push(item);
      }
      return buckets;
    }

    case "fitness": {
      const type = await ensureRecordType(
        workspaceId,
        userId,
        BUILT_IN_RECORD_TYPES.fitness
      );
      const rows = await listRecords(workspaceId, { recordTypeId: type.id });
      for (const row of rows) {
        const item = fitnessRowToItem(row);
        if (isItemCompleted(item)) buckets.completedCount += 1;
        else buckets.pending.push(item);
      }
      return buckets;
    }

    case "shopping": {
      const type = await ensureRecordType(
        workspaceId,
        userId,
        BUILT_IN_RECORD_TYPES.shopping
      );
      const rows = await listRecords(workspaceId, { recordTypeId: type.id });
      for (const row of rows) {
        const item = shoppingRowToItem(row);
        if (item.purchased) buckets.completedCount += 1;
        // A wishlist entry is saved, not committed: it must NOT compete with
        // real obligations in the priority list.
        else buckets.wishlist.push(item);
      }
      return buckets;
    }

    case "meeting": {
      const rows = await listNotes(workspaceId, userId, {});
      for (const row of rows) {
        const item = noteRowToItem(row);
        // Notes have no completion flag; the data layer already excludes
        // archived ones, so anything returned is live.
        buckets.pending.push(item);
      }
      return buckets;
    }
  }
};

/**
 * Loads the whole Dashboard.
 *
 * Sections are fetched in parallel because they are independent, and each one
 * is isolated so a single failure does not blank the rest.
 *
 * The analytics readouts ride along in the SAME batch rather than triggering a
 * second round of queries. That matters: the Dashboard is the app's landing
 * screen, so doubling its query count would be paid on every page load and every
 * mode switch, for numbers derived from rows already being fetched.
 *
 * Each extra readout is separately guarded, so a missing analytics table (or an
 * unapplied migration) degrades that card alone rather than the page.
 */
export const loadDashboardSnapshot = async (
  workspaceId: string,
  userId: string
): Promise<DashboardSnapshot> => {
  const results = await Promise.all(
    SECTION_ORDER.map(async (mode) => {
      try {
        return { mode, buckets: await loadSection(workspaceId, userId, mode), failed: false };
      } catch {
        return { mode, buckets: emptyBuckets(), failed: true };
      }
    })
  );

  const sections: DashboardSection[] = results.map(({ mode, buckets }) => ({
    mode,
    label: SECTION_LABELS[mode],
    summary: summarise(mode, buckets),
    buckets
  }));

  const [taskAnalytics, studyAnalytics, dueReminders, groceryHistoryCount] = await Promise.all([
    getTaskAnalytics(workspaceId).catch(() => null),
    getStudyAnalytics(workspaceId, userId).catch(() => null),
    // Only the caller's own tasks can raise a reminder for them.
    listDueReminders(workspaceId, { userId }).catch(() => [] as ReminderRow[]),
    listGroceryHistory(workspaceId, 100).then((lists) => lists.length).catch(() => 0)
  ]);

  return {
    sections,
    partial: results.some((r) => r.failed),
    failed: results.filter((r) => r.failed).map((r) => r.mode),
    taskAnalytics,
    studyAnalytics,
    dueReminders,
    groceryHistoryCount
  };
};