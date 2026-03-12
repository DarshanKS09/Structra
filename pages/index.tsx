import Head from "next/head";
import { useEffect, useState } from "react";
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
import { type ThemeVariant, useTaskStore } from "@/store/useTaskStore";
import { type DraftByMode, type ListItem, type ListMode, modeLabels } from "@/types/taskTypes";

export default function HomePage() {
  const [mounted, setMounted] = useState(false);
  const [themePulseId, setThemePulseId] = useState(0);
  const {
    selectedMode,
    setMode,
    isAddModalOpen,
    openAddModal,
    closeAddModal,
    addItem,
    updateItem,
    deleteItem,
    toggleCompletion,
    startEditing,
    editingItemId,
    searchQuery,
    setSearchQuery,
    filter,
    setFilter,
    theme,
    setTheme,
    getVisibleItems,
    getItemsForMode,
    getProgress
  } = useTaskStore();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.classList.add("dark");
    document.documentElement.classList.remove("light");
    document.documentElement.classList.remove("theme-ocean", "theme-crimson", "theme-light");
    document.documentElement.classList.add(`theme-${theme}`);
  }, [theme, mounted]);

  const handleAddItem = <M extends ListMode>(mode: M, data: DraftByMode[M]) => {
    addItem(mode, data);
  };

  const handleUpdateItem = <M extends ListMode>(
    mode: M,
    id: string,
    data: Partial<DraftByMode[M]>
  ) => {
    updateItem(mode, id, data);
  };

  const items = selectedMode ? getVisibleItems(selectedMode) : [];
  const allModeItems = selectedMode ? getItemsForMode(selectedMode) : [];
  const editingItem = allModeItems.find((item) => item.id === editingItemId);
  const themeMeta: Record<ThemeVariant, { short: string; className: string }> = {
    ocean: { short: "OC", className: "bg-sky-500 text-slate-950" },
    crimson: { short: "CR", className: "bg-rose-500 text-white" },
    light: { short: "LT", className: "bg-[#d0875c] text-amber-50" }
  };

  const cycleTheme = () => {
    const next: Record<ThemeVariant, ThemeVariant> = {
      ocean: "crimson",
      crimson: "light",
      light: "ocean"
    };
    setTheme(next[theme]);
    setThemePulseId((prev) => prev + 1);
  };

  if (!mounted) return null;

  return (
    <>
      <Head>
        <title>Futuristic Task Manager</title>
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
        <AnimatePresence mode="wait">
          {!selectedMode ? (
            <motion.div
              key="selector"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <ModeSelector onSelect={setMode} />
            </motion.div>
          ) : (
            <motion.section
              key={selectedMode}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              className="space-y-4 px-4 pb-8 pt-6 md:px-8"
            >
              <header className="hidden items-center justify-between md:flex">
                <button
                  type="button"
                  onClick={() => setMode(null)}
                  className="rounded-xl border border-white/20 px-4 py-2 text-sm light:border-slate-300"
                >
                  All Modes
                </button>
                <div className="text-sm font-medium text-slate-300 light:text-slate-600">
                  {modeLabels[selectedMode]}
                </div>
                <motion.button
                  type="button"
                  onClick={cycleTheme}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.93 }}
                  className={`h-10 w-10 rounded-full text-xs font-semibold ${themeMeta[theme].className}`}
                  title="Change Theme"
                >
                  {themeMeta[theme].short}
                </motion.button>
              </header>

              <div className="hidden gap-2 overflow-x-auto pb-1 md:flex">
                {(Object.keys(modeLabels) as ListMode[]).map((mode) => (
                  <motion.button
                    key={mode}
                    type="button"
                    onClick={() => setMode(mode)}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    className={`h-10 rounded-xl px-3 text-sm ${
                      selectedMode === mode
                        ? "themed-accent-solid font-semibold"
                        : "border border-white/20 transition hover:border-white/40 hover:bg-white/10 light:border-slate-300"
                    }`}
                  >
                    {modeLabels[mode]}
                  </motion.button>
                ))}
              </div>

              <div className="md:hidden">
                <div className="flex items-center justify-between">
                  <div className="relative w-44">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-300">
                      ===
                    </span>
                    <select
                      id="mobile-mode-select"
                      value={selectedMode}
                      onChange={(e) => setMode(e.target.value as ListMode)}
                      className="h-11 w-full appearance-none rounded-xl border border-white/20 bg-white/10 pl-8 pr-8 text-sm outline-none"
                    >
                      {(Object.keys(modeLabels) as ListMode[]).map((mode) => (
                        <option key={mode} value={mode} className="text-slate-900">
                          {modeLabels[mode]}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-300">
                      v
                    </span>
                  </div>
                  <motion.button
                    type="button"
                    onClick={cycleTheme}
                    whileTap={{ scale: 0.92 }}
                    className={`h-11 w-11 rounded-full text-xs font-semibold ${themeMeta[theme].className}`}
                    title="Change Theme"
                  >
                    {themeMeta[theme].short}
                  </motion.button>
                </div>
                <div className="mt-2 text-center text-sm font-medium text-slate-200">{modeLabels[selectedMode]}</div>
              </div>

              <ModeToolbar
                mode={selectedMode}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                filter={filter}
                onFilterChange={setFilter}
                progress={getProgress(selectedMode)}
              />

              <FloatingAddButton onClick={openAddModal} inline />

              <ModeView
                mode={selectedMode}
                items={items}
                onToggle={(id) => toggleCompletion(selectedMode, id)}
                onDelete={(id) => deleteItem(selectedMode, id)}
                onEdit={startEditing}
              />

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

