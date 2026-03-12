import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  type DraftByMode,
  type ListItem,
  type ListMode,
  type ModeItemMap
} from "@/types/taskTypes";

type FilterType = "all" | "active" | "completed";
export type ThemeVariant = "ocean" | "crimson" | "light";

type TaskState = {
  selectedMode: ListMode | null;
  itemsByMode: Record<ListMode, ListItem[]>;
  isAddModalOpen: boolean;
  editingItemId: string | null;
  searchQuery: string;
  filter: FilterType;
  theme: ThemeVariant;
  setMode: (mode: ListMode | null) => void;
  addItem: <M extends ListMode>(mode: M, data: DraftByMode[M]) => void;
  updateItem: <M extends ListMode>(
    mode: M,
    id: string,
    data: Partial<DraftByMode[M]>
  ) => void;
  toggleCompletion: (mode: ListMode, id: string) => void;
  deleteItem: (mode: ListMode, id: string) => void;
  openAddModal: () => void;
  closeAddModal: () => void;
  startEditing: (id: string) => void;
  stopEditing: () => void;
  setSearchQuery: (query: string) => void;
  setFilter: (filter: FilterType) => void;
  setTheme: (theme: ThemeVariant) => void;
  getItemsForMode: (mode: ListMode) => ListItem[];
  getVisibleItems: (mode: ListMode) => ListItem[];
  getProgress: (mode: ListMode) => number;
};

const initialModeData: Record<ListMode, ListItem[]> = {
  task: [],
  grocery: [],
  habit: [],
  study: [],
  fitness: [],
  shopping: [],
  meeting: []
};

const isCompleted = (item: ListItem): boolean =>
  "completed" in item ? item.completed : "purchased" in item ? item.purchased : false;

const matchesSearch = (item: ListItem, query: string): boolean => {
  if (!query.trim()) return true;
  const normalized = query.toLowerCase();
  const blob = Object.values(item)
    .filter((value) => typeof value === "string" || typeof value === "number")
    .join(" ")
    .toLowerCase();
  return blob.includes(normalized);
};

const getSortableLabel = (item: ListItem): string => {
  switch (item.mode) {
    case "task":
      return item.title;
    case "grocery":
      return item.itemName;
    case "habit":
      return item.habitName;
    case "study":
      return `${item.subject} ${item.topic}`;
    case "fitness":
      return item.exerciseName;
    case "shopping":
      return item.itemName;
    case "meeting":
      return item.meetingTitle;
  }
};

const buildItem = <M extends ListMode>(mode: M, data: DraftByMode[M]): ModeItemMap[M] => {
  const now = new Date().toISOString();
  return {
    ...data,
    id: crypto.randomUUID(),
    mode,
    createdAt: now,
    updatedAt: now
  } as ModeItemMap[M];
};

export const useTaskStore = create<TaskState>()(
  persist(
    (set, get) => ({
      selectedMode: null,
      itemsByMode: initialModeData,
      isAddModalOpen: false,
      editingItemId: null,
      searchQuery: "",
      filter: "all",
      theme: "ocean",
      setMode: (mode) => set({ selectedMode: mode, searchQuery: "", filter: "all" }),
      addItem: (mode, data) =>
        set((state) => {
          const item = buildItem(mode, data);
          return {
            itemsByMode: {
              ...state.itemsByMode,
              [mode]: [item, ...state.itemsByMode[mode]]
            },
            isAddModalOpen: false
          };
        }),
      updateItem: (mode, id, data) =>
        set((state) => ({
          itemsByMode: {
            ...state.itemsByMode,
            [mode]: state.itemsByMode[mode].map((item) =>
              item.id === id ? { ...item, ...data, updatedAt: new Date().toISOString() } : item
            )
          },
          editingItemId: null,
          isAddModalOpen: false
        })),
      toggleCompletion: (mode, id) =>
        set((state) => ({
          itemsByMode: {
            ...state.itemsByMode,
            [mode]: state.itemsByMode[mode].map((item) => {
              if (item.id !== id) return item;
              if ("completed" in item) {
                return { ...item, completed: !item.completed, updatedAt: new Date().toISOString() };
              }
              if ("purchased" in item) {
                return { ...item, purchased: !item.purchased, updatedAt: new Date().toISOString() };
              }
              return item;
            })
          }
        })),
      deleteItem: (mode, id) =>
        set((state) => ({
          itemsByMode: {
            ...state.itemsByMode,
            [mode]: state.itemsByMode[mode].filter((item) => item.id !== id)
          }
        })),
      openAddModal: () => set({ isAddModalOpen: true }),
      closeAddModal: () => set({ isAddModalOpen: false, editingItemId: null }),
      startEditing: (id) => set({ editingItemId: id, isAddModalOpen: true }),
      stopEditing: () => set({ editingItemId: null }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      setFilter: (filter) => set({ filter }),
      setTheme: (theme) => set({ theme }),
      getItemsForMode: (mode) => get().itemsByMode[mode],
      getVisibleItems: (mode) => {
        const { filter, searchQuery } = get();
        return get()
          .itemsByMode[mode]
          .filter((item) => matchesSearch(item, searchQuery))
          .filter((item) => {
            if (filter === "all") return true;
            const complete = isCompleted(item);
            return filter === "completed" ? complete : !complete;
          })
          .sort((a, b) =>
            getSortableLabel(a).localeCompare(getSortableLabel(b), undefined, {
              sensitivity: "base"
            })
          );
      },
      getProgress: (mode) => {
        const items = get().itemsByMode[mode];
        if (!items.length) return 0;
        const completeCount = items.filter(isCompleted).length;
        return Math.round((completeCount / items.length) * 100);
      }
    }),
    {
      name: "futuristic-task-manager-v1",
      version: 2,
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? localStorage : (undefined as unknown as Storage)
      ),
      migrate: (persistedState: unknown) => {
        const state = persistedState as TaskState | undefined;
        if (!state) return state;
        const nextTheme = (state as { theme?: string }).theme === "graphite" ? "light" : state.theme;
        return { ...state, theme: nextTheme ?? "ocean" };
      },
      partialize: (state) => ({
        itemsByMode: state.itemsByMode,
        selectedMode: state.selectedMode,
        theme: state.theme
      })
    }
  )
);
