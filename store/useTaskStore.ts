import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { type ListMode } from "@/types/taskTypes";

/**
 * Client/UI state only.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED AND WHY
 * ---------------------------------------------------------------------------
 *
 * This store previously held every item in `itemsByMode` and persisted the whole
 * thing to localStorage. That made the browser the source of truth for
 * user-owned data, which is incompatible with a multi-user product: the data
 * could not be shared between devices, was lost when localStorage was cleared,
 * and was never subject to Row Level Security.
 *
 * PostgreSQL is now the source of truth. This store keeps ONLY ephemeral UI
 * state:
 *
 *   selectedMode      which list the user is looking at
 *   isAddModalOpen    modal visibility
 *   editingItemId     which item the modal is editing
 *   searchQuery       in-progress filter text
 *   filter            all | active | completed
 *   theme             visual preference
 *
 * Data flows the other way now:
 *
 *   UI -> hooks (@/lib/hooks/useModeItems) -> data layer (@/lib/data)
 *      -> Supabase -> PostgreSQL + RLS
 *
 * `partialize` therefore persists preferences but NOT items, so the localStorage
 * payload cannot become a second source of truth again.
 *
 * Theme is also mirrored to `user_settings` by the caller so it can eventually
 * be applied during a server render; localStorage remains the source for the
 * instant client-side theme application.
 */

export type ThemeVariant = "ocean" | "crimson" | "light";
export type FilterType = "all" | "active" | "completed";

type TaskState = {
  selectedMode: ListMode | null;
  isAddModalOpen: boolean;
  editingItemId: string | null;
  searchQuery: string;
  filter: FilterType;
  theme: ThemeVariant;

  setMode: (mode: ListMode | null) => void;
  openAddModal: () => void;
  closeAddModal: () => void;
  startEditing: (id: string) => void;
  stopEditing: () => void;
  setSearchQuery: (query: string) => void;
  setFilter: (filter: FilterType) => void;
  setTheme: (theme: ThemeVariant) => void;
};

export const useTaskStore = create<TaskState>()(
  persist(
    (set) => ({
      selectedMode: null,
      isAddModalOpen: false,
      editingItemId: null,
      searchQuery: "",
      filter: "all",
      theme: "ocean",

      setMode: (mode) => set({ selectedMode: mode, searchQuery: "", filter: "all" }),
      openAddModal: () => set({ isAddModalOpen: true, editingItemId: null }),
      closeAddModal: () => set({ isAddModalOpen: false, editingItemId: null }),
      startEditing: (id) => set({ editingItemId: id, isAddModalOpen: true }),
      stopEditing: () => set({ editingItemId: null }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      setFilter: (filter) => set({ filter }),
      setTheme: (theme) => set({ theme })
    }),
    {
      name: "structra-ui-state-v2",
      version: 2,
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : (undefined as unknown as Storage)
      ),
      /**
       * Preferences only. `itemsByMode` is intentionally excluded: user-owned
       * data now lives in PostgreSQL and must never be re-hydrated from
       * localStorage, which would resurrect deleted rows and bypass RLS.
       */
      partialize: (state) => ({
        selectedMode: state.selectedMode,
        theme: state.theme
      })
    }
  )
);