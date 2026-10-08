import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GetServerSideProps } from "next";
import { AnimatePresence, motion } from "framer-motion";
import { AddItemModal } from "@/components/AddItemModal";
import { FitnessList } from "@/components/FitnessList";
import { FloatingAddButton } from "@/components/FloatingAddButton";
import { GroceryList } from "@/components/GroceryList";
import { HabitList } from "@/components/HabitList";
import { MeetingList } from "@/components/MeetingList";
import { ModeSelector } from "@/components/ModeSelector";
import { ModeToolbar } from "@/components/ModeToolbar";
import { ShoppingList } from "@/components/ShoppingList";
import { StudyList } from "@/components/StudyList";
import { TaskList } from "@/components/TaskList";
import { LocalDataImport } from "@/components/LocalDataImport";
import { AuthProvider, useAuth } from "@/lib/auth/AuthProvider";
import { useDashboard } from "@/lib/hooks/useDashboard";
import { useModeItems } from "@/lib/hooks/useModeItems";
import { Dashboard } from "@/components/Dashboard";
import { NavBar } from "@/components/NavBar";
import { QuickAdd } from "@/components/QuickAdd";
import { completeItem } from "@/lib/dashboard/complete";
import { setTheme as persistTheme } from "@/lib/data/account";
import type { ProfileRow, UserSettingsRow, WorkspaceWithRole } from "@/lib/data/types";
import { type ThemeVariant, useTaskStore } from "@/store/useTaskStore";
import {
  type DraftByMode,
  type ListItem,
  type ListMode
} from "@/types/taskTypes";

type HomePageProps = {
  initialUserId?: string | null;
  initialProfile?: ProfileRow | null;
  initialWorkspace?: WorkspaceWithRole | null;
  initialSettings?: UserSettingsRow | null;
};

/**
 * `getServerSideProps` already resolved the profile, workspace and settings, so
 * they are handed to the provider instead of being fetched again on the client.
 * Without this the profile control would flash an empty state on every load
 * while a duplicate round trip was in flight.
 */
export default function HomePage({
  initialUserId = null,
  initialProfile = null,
  initialWorkspace = null,
  initialSettings = null
}: HomePageProps) {
  return (
    <AuthProvider
      initialUserId={initialUserId}
      initialProfile={initialProfile}
      initialWorkspace={initialWorkspace}
      initialSettings={initialSettings}
    >
      <HomeContent />
    </AuthProvider>
  );
}

/**
 * The application shell.
 *
 * The layout, mode switching, modal and list rendering are unchanged from the
 * original implementation. What changed is the source of the `items` array: it
 * now comes from `useModeItems` (hooks -> data layer -> Supabase) instead of the
 * Zustand store's localStorage payload.
 *
 * The page is protected by `getServerSideProps` below, so this component only
 * ever renders for an authenticated user. The `unknown` auth status is still
 * handled rather than assumed, so a session that expires mid-session produces a
 * clear message instead of a blank screen.
 */
function HomeContent() {
  const [mounted, setMounted] = useState(false);
  const [themePulseId, setThemePulseId] = useState(0);

  const { status, user, profile, workspace, bootstrapping, error: authError, signOut } = useAuth();

  const {
    view,
    setView,
    isAddModalOpen,
    openAddModal,
    closeAddModal,
    editingItemId,
    startEditing,
    searchQuery,
    setSearchQuery,
    filter,
    setFilter,
    theme,
    setTheme
  } = useTaskStore();

  // The Dashboard is the landing screen, so it is not a `ListMode`. It renders
  // from `useDashboard`, which reads the same tables through the same data
  // layer; the section hook is only engaged when a real section is on screen.
  const selectedMode: ListMode | null =
    view === "dashboard" || view === "modes" ? null : view;

  const dashboard = useDashboard();

  const modeItems = useModeItems(
    selectedMode ?? "task",
    filter,
    searchQuery
  );

  const { items, reload, create, update, toggle, remove, counts, status: dataStatus, error: dataError } = modeItems;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.classList.add("dark");
    document.documentElement.classList.remove("light");
    document.documentElement.classList.remove("theme-ocean", "theme-crimson", "theme-light");
    document.documentElement.classList.add(`theme-${theme}`);
  }, [theme, mounted]);

  // Mirror the theme into user_settings so it is available server-side later.
  // Failure is intentionally ignored: a theme sync must never block the app.
  useEffect(() => {
    if (!user) return;
    void persistTheme(user.id, theme as "ocean" | "crimson" | "light").catch(() => undefined);
  }, [theme, user]);

  const editingItem = useMemo(
    () => (editingItemId ? items.find((item) => item.id === editingItemId) : undefined),
    [editingItemId, items]
  );

  const themeMeta: Record<ThemeVariant, { short: string; className: string }> = {
    ocean: { short: "OC", className: "bg-sky-500 text-slate-950" },
    crimson: { short: "CR", className: "bg-rose-500 text-white" },
    light: { short: "LT", className: "bg-[#d0875c] text-amber-50" }
  };

  const cycleTheme = useCallback(() => {
    const next: Record<ThemeVariant, ThemeVariant> = {
      ocean: "crimson",
      crimson: "light",
      light: "ocean"
    };
    setTheme(next[theme]);
    setThemePulseId((prev) => prev + 1);
  }, [theme, setTheme]);

  const handleAddItem = useCallback(
    async <M extends ListMode>(mode: M, draft: DraftByMode[M]) => {
      // The modal produces a fully-formed draft; wrap it into the ListItem
      // shape the hook expects without changing the modal's own contract.
      const item = draftToItem(mode, draft) as ListItem;
      const result = await create(item);
      if (result.ok) {
        closeAddModal();
        // A Dashboard quick-add creates a row in another mode's table, so the
        // Dashboard is re-read to pick it up immediately.
        if (mode !== selectedMode) void dashboard.reload();
      }
      // Returning the outcome lets the quick-add flow close its own modal.
      return result.ok;
    },
    [create, closeAddModal, selectedMode, dashboard]
  );

  const handleUpdateItem = useCallback(
    async <M extends ListMode>(mode: M, id: string, partial: Partial<DraftByMode[M]>) => {
      const existing = items.find((row) => row.id === id);
      if (!existing) return;
      const merged = { ...existing, ...partial } as ListItem;
      const result = await update(id, merged);
      if (result.ok) closeAddModal();
    },
    [items, update, closeAddModal]
  );

  const handleToggle = useCallback((id: string) => void toggle(id), [toggle]);
  const handleDelete = useCallback((id: string) => void remove(id), [remove]);

  /**
   * Quick-add target.
   *
   * `null` means the picker is closed. The modal and the create call are the
   * existing ones, so a Dashboard-created item is written by exactly the same
   * path as one created inside its section.
   */
  const [quickAddMode, setQuickAddMode] = useState<ListMode | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const greeting = useMemo(() => {
    const name = profile?.display_name?.trim();
    if (name) return `Welcome back, ${name.split(/\s+/)[0]}`;
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }, [profile?.display_name]);

  /**
   * Completes an item from the Dashboard.
   *
   * The write goes through `completeItem`, which dispatches to the same
   * data-layer function the section screen uses. The Dashboard then re-reads
   * from Supabase, so counts and ordering reflect the database rather than a
   * local guess.
   */
  const handleDashboardComplete = useCallback(
    async (entry: { item: { id: string }; mode: ListMode }) => {
      if (!workspace || !user) return;
      await dashboard.complete(entry.mode, entry.item.id, async () =>
        completeItem({
          mode: entry.mode,
          itemId: entry.item.id,
          workspaceId: workspace.id,
          userId: user.id,
          done: true
        })
      );
    },
    [workspace, user, dashboard]
  );

  if (!mounted) return null;

  // ---- auth / bootstrap gates -------------------------------------------
  if (status === "unknown") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-slate-400 light:text-slate-500">Checking your session...</p>
      </main>
    );
  }

  if (status === "unauthenticated") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-sm space-y-4 text-center">
          <h1 className="text-xl font-semibold">Your session has ended</h1>
          <p className="text-sm text-slate-400 light:text-slate-500">
            Sign in again to reach your synced lists.
          </p>
          {/* A full navigation, not client-side routing: re-running
              getServerSideProps is what establishes the session for the new
              request after a silent token refresh has failed. */}
          <Link
            href="/login"
            className="themed-accent-solid inline-flex h-11 items-center rounded-2xl px-5 text-sm font-semibold"
          >
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  if (bootstrapping || !workspace) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-slate-400 light:text-slate-500">Preparing your workspace...</p>
      </main>
    );
  }

  return (
    <>
      <Head>
        <title>Structra</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>

      <AnimatePresence>
        {themePulseId > 0 && (
          <motion.div
            key={themePulseId}
            initial={{ opacity: 0.45, scale: 0.7 }}
            animate={{ opacity: 0, scale: 1.18 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.65, ease: "easeOut" }}
            className="pointer-events-none fixed inset-0 z-0"
            style={{
              background: "radial-gradient(circle at 85% 10%, var(--accent), transparent 55%)"
            }}
          />
        )}
      </AnimatePresence>

      <main className="relative z-10 mx-auto min-h-screen w-full max-w-5xl pb-20">
        {authError ? (
          <div
            role="alert"
            className="mx-4 mt-4 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200 md:mx-8"
          >
            {authError.message}
          </div>
        ) : null}

        {/* One-time import of any pre-Supabase localStorage data. */}
        <LocalDataImport />

        <AnimatePresence mode="wait">
          {view === "dashboard" ? (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4 px-4 pb-8 pt-6 md:px-8"
            >
              <NavBar
                view={view}
                onNavigate={setView}
                themeLabel={themeMeta[theme].short}
                themeClassName={themeMeta[theme].className}
                onCycleTheme={cycleTheme}
              />
              <Dashboard
                sections={dashboard.sections}
                priority={dashboard.priority}
                totals={dashboard.totals}
                greeting={greeting}
                onComplete={(entry) => void handleDashboardComplete(entry)}
                onOpenSection={(mode) => setView(mode)}
                isRefreshing={dashboard.status === "loading"}
              />
              {dashboard.error ? (
                <div
                  role="alert"
                  className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200 light:text-rose-700"
                >
                  <p>{dashboard.error.message}</p>
                  <button
                    type="button"
                    onClick={() => void dashboard.reload()}
                    className="mt-1 text-xs underline underline-offset-2"
                  >
                    Try again
                  </button>
                </div>
              ) : null}
              {/* Quick add: choose a section, reuse the existing modal and the
                  existing create path, so the row lands in the right table and
                  the Dashboard picks it up on its next read. */}
              <FloatingAddButton onClick={openAddModal} inline />
              <QuickAdd
                open={quickAddOpen}
                onPick={(mode) => {
                  setQuickAddOpen(false);
                  setQuickAddMode(mode);
                }}
                onClose={() => setQuickAddOpen(false)}
              />
              {quickAddMode ? (
                <AddItemModal
                  mode={quickAddMode}
                  isOpen={Boolean(quickAddMode)}
                  onClose={() => setQuickAddMode(null)}
                  onSubmit={async (mode, draft) => {
                    const created = await handleAddItem(mode, draft);
                    if (created) setQuickAddMode(null);
                  }}
                  onUpdate={handleUpdateItem}
                />
              ) : null}
            </motion.div>
          ) : !selectedMode ? (
            <motion.div
              key="selector"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <ModeSelector onSelect={(mode) => setView(mode)} />
            </motion.div>
          ) : (
            <motion.section
              key={selectedMode}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              className="space-y-4 px-4 pb-8 pt-6 md:px-8"
            >
              {/* Navigation is the same component the Dashboard uses, so the
                  Dashboard is always the first item in both layouts. */}
              <NavBar
                view={view}
                onNavigate={setView}
                themeLabel={themeMeta[theme].short}
                themeClassName={themeMeta[theme].className}
                onCycleTheme={cycleTheme}
              />

              <ModeToolbar
                mode={selectedMode}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                filter={filter}
                onFilterChange={setFilter}
                progress={items.length > 0 ? computeProgress(items) : 0}
                counts={counts}
              />

              <FloatingAddButton onClick={openAddModal} inline />

              {dataError ? (
                <div
                  role="alert"
                  className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200 light:text-rose-700"
                >
                  <p>{dataError.message}</p>
                  <button
                    type="button"
                    onClick={() => void reload()}
                    className="mt-1 text-xs underline underline-offset-2"
                  >
                    Try again
                  </button>
                </div>
              ) : null}

              <div aria-busy={dataStatus === "loading"}>
                <ModeView
                  mode={selectedMode}
                  items={items}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onEdit={startEditing}
                />
              </div>

              <AddItemModal
                mode={selectedMode}
                isOpen={isAddModalOpen}
                editingItem={editingItem}
                onClose={closeAddModal}
                onSubmit={handleAddItem}
                onUpdate={handleUpdateItem}
              />
            </motion.section>
          )}
        </AnimatePresence>
      </main>
    </>
  );
}

function computeProgress(items: ListItem[]): number {
  if (items.length === 0) return 0;
  const complete = items.filter((item) => {
    if ("completed" in item) return item.completed;
    if ("purchased" in item) return item.purchased;
    return false;
  }).length;
  return Math.round((complete / items.length) * 100);
}

/**
 * Wraps a modal draft into the `ListItem` shape used by the data layer.
 *
 * The ids and timestamps are placeholders: the database generates both, and the
 * hook passes the object straight to an insert. Meeting items have no
 * completion concept, matching the original behaviour.
 */
function draftToItem<M extends ListMode>(mode: M, draft: DraftByMode[M]): ListItem {
  const now = new Date().toISOString();
  const base = { id: "pending", mode, createdAt: now, updatedAt: now };

  switch (mode) {
    case "task":
      return { ...base, mode, ...draft } as ListItem;
    case "grocery":
      return { ...base, mode, ...draft } as ListItem;
    case "habit":
      return { ...base, mode, ...draft } as ListItem;
    case "study":
      return { ...base, mode, ...draft } as ListItem;
    case "fitness":
      return { ...base, mode, ...draft } as ListItem;
    case "shopping":
      return { ...base, mode, ...draft } as ListItem;
    case "meeting":
      return { ...base, mode, ...draft } as ListItem;
    default:
      // Unreachable: ListMode is a closed union. Kept exhaustive-safe.
      return { ...base, mode: mode as never } as unknown as ListItem;
  }
}

function ModeView({
  mode,
  items,
  onToggle,
  onDelete,
  onEdit
}: {
  mode: ListMode;
  items: ListItem[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  switch (mode) {
    case "task":
      return <TaskList items={items} onToggle={onToggle} onDelete={onDelete} onEdit={onEdit} />;
    case "grocery":
      return <GroceryList items={items} onToggle={onToggle} onDelete={onDelete} onEdit={onEdit} />;
    case "habit":
      return <HabitList items={items} onToggle={onToggle} onDelete={onDelete} onEdit={onEdit} />;
    case "study":
      return <StudyList items={items} onToggle={onToggle} onDelete={onDelete} onEdit={onEdit} />;
    case "fitness":
      return <FitnessList items={items} onToggle={onToggle} onDelete={onDelete} onEdit={onEdit} />;
    case "shopping":
      return <ShoppingList items={items} onToggle={onToggle} onDelete={onDelete} onEdit={onEdit} />;
    case "meeting":
      return <MeetingList items={items} onToggle={onToggle} onDelete={onDelete} onEdit={onEdit} />;
  }
}

/**
 * Server-side gate.
 *
 * `getServerSideProps` runs only on the server, so the `server-only` modules
 * (which deliberately throw if they reach a client bundle) are imported
 * dynamically here. Next.js removes this function - and anything it references
 * - from the client bundle, which is what keeps that guarantee intact.
 *
 * The session is established on the server, so an unauthenticated visitor is
 * redirected before any application HTML is sent.
 */
export const getServerSideProps: GetServerSideProps<BootstrapProps> = async (context) => {
  const { getServerSession, buildRedirect } = await import("@/lib/auth/server");
  const { createServerClientForRequest } = await import("@/lib/supabase/server");

  const session = await getServerSession(context);
  if (!session) {
    return buildRedirect("/login");
  }

  try {
    const supabase = createServerClientForRequest(context.req, context.res);

    // One round trip in parallel, so the first paint already has everything and
    // the client does not have to repeat the bootstrap.
    const [profileResult, membershipResult, settingsResult] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", session.userId).maybeSingle(),
      supabase
        .from("workspace_members")
        .select("workspace_id, role")
        .eq("user_id", session.userId)
        .eq("role", "owner")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase.from("user_settings").select("*").eq("user_id", session.userId).maybeSingle()
    ]);

    let workspace: BootstrapProps["initialWorkspace"] = null;
    if (membershipResult.data) {
      const { data } = await supabase
        .from("workspaces")
        .select("*")
        .eq("id", membershipResult.data.workspace_id)
        .maybeSingle();
      if (data) workspace = { ...data, role: membershipResult.data.role };
    }

    return {
      props: {
        initialUserId: session.userId,
        initialProfile: profileResult.data ?? null,
        initialWorkspace: workspace,
        initialSettings: settingsResult.data ?? null
      }
    };
  } catch {
    // A bootstrap failure must not block rendering. The provider retries on the
    // client and shows a clear error state rather than an empty app.
    return {
      props: {
        initialUserId: session.userId,
        initialProfile: null,
        initialWorkspace: null,
        initialSettings: null
      }
    };
  }
};

/** Server-side variants that use the request-scoped client, not the browser one. */
type BootstrapProps = {
  initialUserId: string;
  initialProfile: ProfileRow | null;
  initialWorkspace: WorkspaceWithRole | null;
  initialSettings: UserSettingsRow | null;
};