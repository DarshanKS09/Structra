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
  dueDate: string;
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
  estimatedStudyTime: string;
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
