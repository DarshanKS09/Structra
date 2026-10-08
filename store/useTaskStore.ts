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

/**
 * The appearance the user chose, in Profile -> Appearance.
 *
 * Deliberately TWO options. "System" was removed because it made the setting
 * ambiguous: with three choices, "Light" and "Dark" could each silently lose to
 * the operating system, so the control could not state what the user would
 * actually see. Two options always describe what is on screen.
 *
 * `dark` is not itself a `ThemeVariant`: Structra has two dark accents (Ocean and
 * Crimson). So appearance answers "bright or dark" while `theme` keeps answering
 * "which colour", which is what lets Ocean and Crimson remain available inside
 * both appearances without a second theme system.
 */
export type Appearance = "light" | "dark";

/** The dark accents a user can pick while in a dark appearance. */
export type DarkAccent = Extract<ThemeVariant, "ocean" | "crimson">;

export type FilterType = "all" | "active" | "completed";

type TaskState = {
  /** The landing screen. Defaults to the Dashboard. */
  view: AppView;
  isAddModalOpen: boolean;
  editingItemId: string | null;
  searchQuery: string;
  filter: FilterType;
  theme: ThemeVariant;
  /**
   * Bright / dark / follow-the-OS.
   *
   * Defaults to "dark" because that is Structra's historical appearance, so the
   * app looks the same as it did before this field existed. An existing user's
   * saved `theme: "light"` is reconciled on rehydrate.
   */
  appearance: Appearance;
  /**
   * Which dark accent to use while the appearance is dark.
   *
   * Kept separate from `theme` so that switching to Light and back does not
   * destroy the accent the user had chosen.
   */
  darkAccent: DarkAccent;

  /**
   * Monotonic counter bumped after every committed task write.
   *
   * ---------------------------------------------------------------------------
   * WHY THIS EXISTS
   * ---------------------------------------------------------------------------
   * The Dashboard, the section screens and the analytics pages each read tasks
   * through their OWN hook instance, so they hold independent copies of the list.
   * Writing from one left the others showing pre-write state until a full
   * remount - which is why completing a task on the Dashboard did not show up in
   * the Task section, and why the analytics page only updated after a refresh.
   *
   * Rather than merge those caches (a large, risky refactor of a working data
   * layer) this store already owns a shared signal that every reader can watch.
   * A committed write bumps it; each reader re-reads from Supabase when it
   * changes. Supabase remains the only source of truth - the counter carries no
   * task data, it only says "something changed, re-read".
   */
  taskRevision: number;
  /** Signals that task data changed and dependent readers should re-read. */
  bumpTaskRevision: () => void;

  setView: (view: AppView) => void;
  openAddModal: () => void;
  closeAddModal: () => void;
  startEditing: (id: string) => void;
  stopEditing: () => void;
  setSearchQuery: (query: string) => void;
  setFilter: (filter: FilterType) => void;
  setTheme: (theme: ThemeVariant) => void;
  setAppearance: (appearance: Appearance) => void;
  setDarkAccent: (accent: DarkAccent) => void;
  /**
   * Sets both the appearance and the accent in one write.
   *
   * Used by the Profile control so a single click cannot leave the store in a
   * half-updated state that only resolves on the next re-render.
   */
  applyTheme: (input: { appearance: Appearance; accent?: DarkAccent }) => void;
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
      appearance: "dark",
      darkAccent: "ocean",
      taskRevision: 0,

      // Navigating always resets the transient list filters, so returning to a
      // section shows all of it rather than the previous search.
      setView: (view) => set({ view, searchQuery: "", filter: "all" }),
      openAddModal: () => set({ isAddModalOpen: true, editingItemId: null }),
      closeAddModal: () => set({ isAddModalOpen: false, editingItemId: null }),
      startEditing: (id) => set({ editingItemId: id, isAddModalOpen: true }),
      stopEditing: () => set({ editingItemId: null }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      setFilter: (filter) => set({ filter }),
      setTheme: (theme) => set({ theme }),

      // The only cross-surface task signal. It carries no task data - readers
      // re-read from Supabase when it changes - so it cannot become a second
      // source of truth.
      bumpTaskRevision: () => set((state) => ({ taskRevision: state.taskRevision + 1 })),

      /**
       * Changing appearance also re-points `theme`, which is the value the DOM
       * actually reads. `theme` is kept in step so nothing else in the app has to
       * know that appearance and accent are two concepts.
       */
      setAppearance: (appearance) =>
        set((state) => ({
          appearance,
          theme: appearance === "light" ? "light" : state.darkAccent
        })),

      setDarkAccent: (accent) =>
        set((state) => ({
          darkAccent: accent,
          theme: state.appearance === "light" ? state.theme : accent
        })),

      applyTheme: ({ appearance, accent }) =>
        set((state) => {
          const nextAccent = accent ?? state.darkAccent;
          return {
            appearance,
            darkAccent: nextAccent,
            theme: appearance === "light" ? "light" : nextAccent
          };
        })
    }),
    {
      name: "structra-ui-state-v4",
      version: 4,
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
        theme: state.theme,
        appearance: state.appearance,
        darkAccent: state.darkAccent
      }),
      /**
       * Keeps every existing saved preference working across the move to two
       * appearance options.
       *
       * v2 dropped a persisted `selectedMode`, which is what guarantees the
       * Dashboard is the landing screen for every existing user rather than only
       * new ones.
       *
       * v3 payloads may carry `appearance: "system"`, which no longer exists.
       * That is resolved to the appearance the user was ACTUALLY looking at, by
       * asking the OS the same question "System" used to ask on their behalf.
       * Resolving it - rather than forcing everyone to "dark" - is what stops an
       * upgrade from unexpectedly changing somebody's screen. Where the media
       * query is unavailable, "dark" is the fallback because it is Structra's
       * historical default.
       */
      migrate: (persisted: unknown) => {
        const state = (persisted ?? {}) as Partial<TaskState>;

        // A v2 payload persisted only `theme`. A user who had chosen Light must
        // still get Light, so the appearance is inferred from the saved theme.
        const theme = state.theme ?? "ocean";
        const inferredAppearance: Appearance = theme === "light" ? "light" : "dark";
        const inferredAccent: DarkAccent = theme === "crimson" ? "crimson" : "ocean";

        const prefersLight =
          typeof window !== "undefined" && typeof window.matchMedia === "function"
            ? !window.matchMedia("(prefers-color-scheme: dark)").matches
            : false;

        // `state.appearance` is read as a wider type because "system" is valid in
        // a stored v3 payload even though it is no longer a valid choice.
        const stored = state.appearance as Appearance | "system" | undefined;
        const appearance: Appearance =
          stored === "light" ? "light" : stored === "system" ? (prefersLight ? "light" : "dark") : "dark";

        return {
          theme: appearance === "light" ? "light" : state.darkAccent ?? inferredAccent,
          appearance: stored === undefined ? inferredAppearance : appearance,
          darkAccent: state.darkAccent ?? inferredAccent
        } as TaskState;
      }
    }
  )
);