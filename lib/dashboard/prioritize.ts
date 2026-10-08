import type { ListItem, ListMode, PriorityLevel } from "@/types/taskTypes";

/**
 * Dashboard prioritisation.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS PURE AND RULE-BASED
 * ---------------------------------------------------------------------------
 * This module takes items and a clock, and returns an ordering. It performs no
 * I/O, reads no globals, and calls no service. That is deliberate:
 *
 *   - the requirement is explicitly rule-based first, with no AI dependency, so
 *     the Dashboard must work identically with nothing else running;
 *   - a pure function is directly unit-testable, which is the only way to prove
 *     an ordering is stable rather than asserting it looks right;
 *   - giving `now` as a parameter means "overdue" is testable without waiting
 *     for a deadline to pass.
 *
 * ---------------------------------------------------------------------------
 * THE SCORE
 * ---------------------------------------------------------------------------
 * Every actionable item gets a numeric score; higher sorts earlier. The score
 * is a sum of independent signals so a new rule can be added without renumbering
 * the existing ones:
 *
 *   urgency     a deadline has passed, or lands today           0..300
 *   proximity   how soon an upcoming deadline is                0..120
 *   priority    the user's own explicit priority (High/Medium) 0..60
 *   age         untouched items drift upward                   0..40
 *   streak      an unbroken habit streak is a real obligation   0..25
 *
 * Ties are broken deterministically (see `compareItems`) so two runs over the
 * same data always produce the same order - a dashboard that reshuffles itself
 * on every render is worse than one that is merely imperfect.
 */

/** How urgent a deadline is, relative to `now`. */
export type Urgency = "overdue" | "today" | "soon" | "later" | "none";

export type DashboardItem = {
  /** Stable identity: the row id, prefixed so ids cannot collide. */
  key: string;
  item: ListItem;
  /** What the dashboard should call this item. */
  title: string;
  /** Supporting detail, already human-formatted. */
  detail: string;
  mode: ListMode;
  urgency: Urgency;
  /** Higher sorts earlier. Exposed so the UI can explain an ordering. */
  score: number;
  /** Why this item is where it is, for the "why" line in the UI. */
  reasons: string[];
};

export type PriorityBand = "do-first" | "up-next";

export type PrioritisedGroup = {
  /** True when something genuinely needs doing now. */
  doFirst: DashboardItem[];
  /** Worth doing, but not urgent. */
  upNext: DashboardItem[];
  /**
   * Present only so the UI can explain an empty "Do first" area honestly
   * rather than implying something is wrong.
   */
  nothingUrgent: boolean;
};

/** A day in milliseconds. */
const DAY = 86_400_000;

const START_OF_TODAY = (now: number): number => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * Days from today until `iso`, ignoring the time of day.
 *
 * Returns null for a missing or unparseable date, so callers never have to
 * guard. Positive is the future, 0 is today, negative is overdue.
 */
export const daysUntil = (iso: string | null | undefined, now: number): number | null => {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const midnight = new Date(target);
  midnight.setHours(0, 0, 0, 0);
  return Math.round((midnight.getTime() - START_OF_TODAY(now)) / DAY);
};

/** The deadline an item carries, if any. */
export const deadlineOf = (item: ListItem): string | null => {
  if (item.mode === "task") return item.dueDate || null;
  if (item.mode === "meeting") return item.date || null;
  return null;
};

export const urgencyOf = (item: ListItem, now: number): Urgency => {
  const days = daysUntil(deadlineOf(item), now);
  if (days === null) return "none";
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 3) return "soon";
  return "later";
};

const priorityWeight = (priority: PriorityLevel | undefined): number => {
  if (priority === "High") return 60;
  if (priority === "Medium") return 30;
  return 0;
};

/** The user's explicit priority, where the mode has one. */
const explicitPriorityOf = (item: ListItem): PriorityLevel | undefined => {
  if (item.mode === "task" || item.mode === "shopping") return item.priority;
  return undefined;
};

/**
 * How long an item has been sitting unfinished, in whole days.
 *
 * Age is a weak signal on purpose: it breaks ties between equally urgent items
 * so the longest-forgotten one surfaces, but it must never outweigh a deadline.
 */
const ageDays = (item: ListItem, now: number): number => {
  const created = new Date(item.createdAt).getTime();
  if (Number.isNaN(created)) return 0;
  return Math.max(0, Math.floor((now - created) / DAY));
};

/**
 * Builds the dashboard view of a single item.
 *
 * `isDone` is passed in rather than re-derived, because "done" differs by mode
 * (purchased vs completed vs archived) and the caller already knows which.
 */
export const toDashboardItem = (item: ListItem, now: number): DashboardItem => {
  const urgency = urgencyOf(item, now);
  const reasons: string[] = [];
  let score = 0;

  // --- urgency -------------------------------------------------------------
  if (urgency === "overdue") {
    const days = daysUntil(deadlineOf(item), now) ?? 0;
    // Each extra day overdue adds 40, capped, so a very old item cannot
    // outrank everything else forever.
    score += 300 + Math.min(120, Math.abs(days) * 40);
    reasons.push(days === -1 ? "overdue by 1 day" : `overdue by ${Math.abs(days)} days`);
  } else if (urgency === "today") {
    score += 300;
    reasons.push("due today");
  } else if (urgency === "soon") {
    const days = daysUntil(deadlineOf(item), now) ?? 0;
    score += 120;
    reasons.push(days === 1 ? "due tomorrow" : `due in ${days} days`);
  } else if (urgency === "later") {
    const days = daysUntil(deadlineOf(item), now) ?? 0;
    score += 40;
    reasons.push(`due in ${days} days`);
  }

  // --- explicit priority ---------------------------------------------------
  const priority = explicitPriorityOf(item);
  if (priority === "High") {
    score += 60;
    reasons.push("marked high priority");
  } else if (priority === "Medium") {
    score += 30;
    reasons.push("marked medium priority");
  }

  // --- habit streaks -------------------------------------------------------
  // An unbroken streak is a real obligation: breaking it costs the user
  // accumulated progress, which is why it earns a small but non-zero score.
  if (item.mode === "habit" && item.streak > 0) {
    score += Math.min(25, item.streak * 5);
    reasons.push(`${item.streak}-day streak`);
  }

  // --- age -----------------------------------------------------------------
  const age = ageDays(item, now);
  if (age >= 3) {
    score += Math.min(40, age * 4);
    reasons.push(age === 1 ? "waiting a day" : `waiting ${age} days`);
  }

  // --- titles --------------------------------------------------------------
  let title: string;
  let detail: string;

  switch (item.mode) {
    case "task":
      title = item.title;
      detail = item.priority === "High" ? "High priority" : item.priority;
      break;
    case "grocery":
      title = item.itemName;
      detail = `${item.quantity} ${item.unit}`;
      break;
    case "habit":
      title = item.habitName;
      detail = `${item.frequency} · ${item.streak}-day streak`;
      break;
    case "study":
      title = `${item.subject}${item.topic ? ` · ${item.topic}` : ""}`;
      detail = item.estimatedStudyTime ? `~${item.estimatedStudyTime}` : "Study session";
      break;
    case "fitness":
      title = item.exerciseName;
      detail = `${item.sets} × ${item.reps}`;
      break;
    case "shopping":
      title = item.itemName;
      detail = item.price > 0 ? `~${item.price}` : "Wishlist";
      break;
    case "meeting":
      title = item.meetingTitle;
      detail = item.participants || "Meeting";
      break;
  }

  return {
    key: `${item.mode}:${item.id}`,
    item,
    title,
    detail,
    mode: item.mode,
    urgency,
    score,
    reasons
  };
};

/**
 * Total ordering for the priority list.
 *
 * The trailing comparisons are what make this deterministic. Without them, two
 * items with equal scores could swap places between renders depending on the
 * order the underlying queries happened to return, which reads as the Dashboard
 * being unstable.
 */
export const compareItems = (a: DashboardItem, b: DashboardItem): number => {
  if (b.score !== a.score) return b.score - a.score;
  const aDue = deadlineOf(a.item);
  const bDue = deadlineOf(b.item);
  // An item with a deadline outranks one without at equal score.
  if (aDue && !bDue) return -1;
  if (!aDue && bDue) return 1;
  if (aDue && bDue) {
    const delta = new Date(aDue).getTime() - new Date(bDue).getTime();
    if (delta !== 0) return delta;
  }
  const byCreated = new Date(a.item.createdAt).getTime() - new Date(b.item.createdAt).getTime();
  if (byCreated !== 0) return byCreated;
  // Final tiebreak on id so the order is total even for identical timestamps.
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
};

/**
 * Splits pending items into the two priority bands.
 *
 * The split is by URGENCY, not by score, so the "Do first" area means exactly
 * "has a deadline that has passed or is today". Ranking within each band is by
 * score. That keeps the two sections answering different questions: the first
 * is "what is late?", the second is "what is next?".
 */
export const splitByPriority = (items: DashboardItem[]): PrioritisedGroup => {
  const sorted = [...items].sort(compareItems);
  const urgent = sorted.filter(
    (entry) => entry.urgency === "overdue" || entry.urgency === "today"
  );
  return {
    doFirst: urgent,
    upNext: sorted.filter((entry) => !urgent.includes(entry)),
    nothingUrgent: urgent.length === 0
  };
};

/** "Overdue" items on their own, for the summary tiles. */
export const countOverdue = (items: DashboardItem[]): number =>
  items.filter((entry) => entry.urgency === "overdue").length;

export const countDueToday = (items: DashboardItem[]): number =>
  items.filter((entry) => entry.urgency === "today").length;