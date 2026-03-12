import Head from "next/head";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AddItemModal } from "@/components/AddItemModal";
import { BottomNav } from "@/components/BottomNav";
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
import { useTaskStore } from "@/store/useTaskStore";
import { type DraftByMode, type ListItem, type ListMode, modeLabels } from "@/types/taskTypes";

export default function HomePage() {
  const [mounted, setMounted] = useState(false);
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
    isDarkMode,
    toggleDarkMode,
    getVisibleItems,
    getItemsForMode,
    getProgress
  } = useTaskStore();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.classList.toggle("dark", isDarkMode);
    document.documentElement.classList.toggle("light", !isDarkMode);
  }, [isDarkMode, mounted]);

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

  if (!mounted) return null;

  return (
    <>
      <Head>
        <title>Futuristic Task Manager</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>

      <main className="mx-auto min-h-screen w-full max-w-5xl pb-20">
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
                <button
                  type="button"
                  onClick={toggleDarkMode}
                  className="rounded-xl border border-white/20 px-4 py-2 text-sm light:border-slate-300"
                >
                  {isDarkMode ? "Light" : "Dark"} Mode
                </button>
              </header>

              <div className="hidden gap-2 overflow-x-auto pb-1 md:flex">
                {(Object.keys(modeLabels) as ListMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setMode(mode)}
                    className={`h-10 rounded-xl px-3 text-sm ${
                      selectedMode === mode
                        ? "bg-sky-500 font-semibold text-slate-950"
                        : "border border-white/20 light:border-slate-300"
                    }`}
                  >
                    {modeLabels[mode]}
                  </button>
                ))}
              </div>

              <ModeToolbar
                mode={selectedMode}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                filter={filter}
                onFilterChange={setFilter}
                progress={getProgress(selectedMode)}
              />

              <ModeView
                mode={selectedMode}
                items={items}
                onToggle={(id) => toggleCompletion(selectedMode, id)}
                onDelete={(id) => deleteItem(selectedMode, id)}
                onEdit={startEditing}
              />

              <FloatingAddButton onClick={openAddModal} />
              <BottomNav
                currentMode={selectedMode}
                onBack={() => setMode(null)}
                onChangeMode={setMode}
                isDarkMode={isDarkMode}
                onToggleTheme={toggleDarkMode}
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
