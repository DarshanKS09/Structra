export type AppView = "dashboard" | "modes" | ListMode;

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
 *   view              which screen is showing (dashboard | modes | a section)
 *   isAddModalOpen    modal visibility
 *   editingItemId     which item the modal is editing
 *   searchQuery       in-progress filter text
 *   filter            all | active | completed
 *   theme             visual preference
 *
 * Data flows the other way now:
 *
 *   UI -> hooks (@/lib/hooks/useModeItems, @/lib/hooks/useDashboard)
 *      -> data layer (@/lib/data, @/lib/dashboard) -> Supabase -> PostgreSQL + RLS
 *
 * `partialize` therefore persists preferences but NOT items, so the localStorage
 * payload cannot become a second source of truth again.
 *
 * ---------------------------------------------------------------------------
 * WHY `view` REPLACED `selectedMode`
 * ---------------------------------------------------------------------------
 * The landing screen is now the Dashboard, which is not a `ListMode`. Extending
 * `ListMode` with a "dashboard" member would have pushed that special case into
 * every list component, every data-layer branch and every type union.
 *
 * A separate `view` keeps the two concerns apart: `view` is navigation state,
 * while a `ListMode` is still a closed union describing a real section. Every
 * section screen continues to receive a valid `ListMode`, so no existing
 * component had to change.
 *
 * Theme is also mirrored to `user_settings` by the caller so it can eventually
 * be applied during a server render; localStorage remains the source for the
 * instant client-side theme application.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { type ListMode } from "@/types/taskTypes";

export type ThemeVariant = "ocean" | "crimson" | "light";
export type FilterType = "all" | "active" | "completed";

type TaskState = {
  /** The landing screen. Defaults to the Dashboard. */
  view: AppView;
  isAddModalOpen: boolean;
  editingItemId: string | null;
  searchQuery: string;
  filter: FilterType;
  theme: ThemeVariant;

  setView: (view: AppView) => void;
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
      view: "dashboard",
      isAddModalOpen: false,
      editingItemId: null,
      searchQuery: "",
      filter: "all",
      theme: "ocean",

      // Navigating always resets the transient list filters, so returning to a
      // section shows all of it rather than the previous search.
      setView: (view) => set({ view, searchQuery: "", filter: "all" }),
      openAddModal: () => set({ isAddModalOpen: true, editingItemId: null }),
      closeAddModal: () => set({ isAddModalOpen: false, editingItemId: null }),
      startEditing: (id) => set({ editingItemId: id, isAddModalOpen: true }),
      stopEditing: () => set({ editingItemId: null }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      setFilter: (filter) => set({ filter }),
      setTheme: (theme) => set({ theme })
    }),
    {
      name: "structra-ui-state-v3",
      version: 3,
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : (undefined as unknown as Storage)
      ),
      /**
       * Preferences only. `itemsByMode` is intentionally excluded: user-owned
       * data now lives in PostgreSQL and must never be re-hydrated from
       * localStorage, which would resurrect deleted rows and bypass RLS.
       *
       * `view` is also deliberately NOT persisted, even though it is only UI
       * state. The requirement is that a returning user lands on the Dashboard
       * whenever they open Structra; remembering the last section would send them
       * straight back into a list and quietly defeat that.
       */
      partialize: (state) => ({
        theme: state.theme
      }),
      /**
       * v2 payloads carried a persisted `selectedMode`. Dropping it on
       * rehydrate is what guarantees the Dashboard is the landing screen for
       * every existing user, not only new ones.
       */
      migrate: (persisted: unknown) => {
        const state = (persisted ?? {}) as Partial<TaskState>;
        return { theme: state.theme ?? "ocean" } as TaskState;
      }
    }
  )
);