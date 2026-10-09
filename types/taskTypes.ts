export type ListMode =
  | "task"
  | "grocery"
  | "habit"
  | "study"
  | "fitness"
  | "shopping"
  | "meeting";

export type PriorityLevel = "Low" | "Medium" | "High";

interface ItemBase {
  id: string;
  mode: ListMode;
  createdAt: string;
  updatedAt: string;
}

export interface TaskItem extends ItemBase {
  mode: "task";
  title: string;
  description: string;
  priority: PriorityLevel;
  /**
   * The deadline as a full ISO instant (`tasks.due_at`).
   *
   * A full timestamp rather than `YYYY-MM-DD` because "overdue", "due today"
   * and reminder scheduling all depend on the time of day. The form converts to
   * and from `datetime-local` at its edges.
   *
   * Empty means there is no deadline. New tasks always have one - the data layer
   * rejects a create without it - but tasks written before that rule existed are
   * still in the database and are shown as "No deadline" rather than being given
   * an invented date.
   */
  dueDate: string;
  /**
   * Minutes before `dueDate` to remind the user, or null for no reminder.
   *
   * The reminder instant is DERIVED as `dueDate - reminderOffsetMinutes` and is
   * never stored, so it cannot drift from the deadline.
   */
  reminderOffsetMinutes: number | null;
  completed: boolean;
}

export interface GroceryItem extends ItemBase {
  mode: "grocery";
  itemName: string;
  quantity: number;
  unit: "kg" | "g" | "pieces" | "liters";
  purchased: boolean;
}

export interface HabitItem extends ItemBase {
  mode: "habit";
  habitName: string;
  frequency: "Daily" | "Weekly";
  streak: number;
  completed: boolean;
}

export interface StudyItem extends ItemBase {
  mode: "study";
  subject: string;
  topic: string;
  /** Display string, derived - never parsed back. See `durationMinutes`. */
  estimatedStudyTime: string;
  /**
   * The session length in MINUTES.
   *
   * ---------------------------------------------------------------------------
   * WHY THIS EXISTS
   * ---------------------------------------------------------------------------
   * The duration used to exist only as free text ("60 min"), so its unit was a
   * guess. `formatDuration` expects SECONDS, so handing it a minutes value
   * divides by 60 a second time: 60 minutes printed as "1 min". That is the
   * exact reported symptom, and it was structural rather than a typo - there was
   * no unit to be wrong about.
   *
   * `durationMinutes` is the single internal unit. The database boundary
   * converts once (minutes -> seconds) and the display converts once
   * (seconds -> a string), so no path can divide twice.
   *
   * Zero means "no duration recorded" rather than "a zero-length session".
   */
  durationMinutes: number;
  completed: boolean;
}

export interface FitnessItem extends ItemBase {
  mode: "fitness";
  exerciseName: string;
  sets: number;
  reps: number;
  duration: string;
  completed: boolean;
}

export interface ShoppingItem extends ItemBase {
  mode: "shopping";
  itemName: string;
  price: number;
  priority: PriorityLevel;
  purchased: boolean;
}

export interface MeetingItem extends ItemBase {
  mode: "meeting";
  meetingTitle: string;
  participants: string;
  date: string;
  notes: string;
}

export type ListItem =
  | TaskItem
  | GroceryItem
  | HabitItem
  | StudyItem
  | FitnessItem
  | ShoppingItem
  | MeetingItem;

export type ModeItemMap = {
  task: TaskItem;
  grocery: GroceryItem;
  habit: HabitItem;
  study: StudyItem;
  fitness: FitnessItem;
  shopping: ShoppingItem;
  meeting: MeetingItem;
};

export type DraftByMode = {
  task: Omit<TaskItem, keyof ItemBase | "mode">;
  grocery: Omit<GroceryItem, keyof ItemBase | "mode">;
  habit: Omit<HabitItem, keyof ItemBase | "mode">;
  study: Omit<StudyItem, keyof ItemBase | "mode">;
  fitness: Omit<FitnessItem, keyof ItemBase | "mode">;
  shopping: Omit<ShoppingItem, keyof ItemBase | "mode">;
  meeting: Omit<MeetingItem, keyof ItemBase | "mode">;
};

export const modeLabels: Record<ListMode, string> = {
  task: "Task List",
  grocery: "Grocery List",
  habit: "Habit Tracker",
  study: "Study Planner",
  fitness: "Fitness Tracker",
  shopping: "Shopping Wishlist",
  meeting: "Meeting Notes"
};

export const modeHints: Record<ListMode, string> = {
  task: "Track priorities and deadlines",
  grocery: "Never miss essentials again",
  habit: "Build consistency over time",
  study: "Plan focused study sessions",
  fitness: "Structure every workout",
  shopping: "Save items you want to buy",
  meeting: "Capture context and decisions"
};
