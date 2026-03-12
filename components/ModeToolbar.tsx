import { motion } from "framer-motion";
import { type ListMode, modeLabels } from "@/types/taskTypes";

type Props = {
  mode: ListMode;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  filter: "all" | "active" | "completed";
  onFilterChange: (value: "all" | "active" | "completed") => void;
  progress: number;
};

export function ModeToolbar({
  mode,
  searchQuery,
  onSearchChange,
  filter,
  onFilterChange,
  progress
}: Props) {
  return (
    <motion.section
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-3 rounded-3xl border border-white/15 bg-surface p-4 backdrop-blur-xl light:border-slate-300 light:bg-white/80"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{modeLabels[mode]}</h2>
        <span className="text-xs text-slate-300 light:text-slate-600">{progress}% completed</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
        <motion.div
          className="themed-accent h-full rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>
      <input
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search items..."
        className="h-11 w-full rounded-2xl border border-white/20 bg-white/10 px-3 text-sm outline-none placeholder:text-slate-300 light:border-slate-300 light:bg-white light:placeholder:text-slate-500"
      />
      <div className="grid grid-cols-3 gap-2">
        {(["all", "active", "completed"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onFilterChange(option)}
            className={`h-10 rounded-xl text-xs font-medium capitalize ${
              filter === option
                ? "themed-accent-solid"
                : "border border-white/20 text-slate-200 light:border-slate-300 light:text-slate-700"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </motion.section>
  );
}
