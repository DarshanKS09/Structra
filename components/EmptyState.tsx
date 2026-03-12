import { motion } from "framer-motion";
import { modeLabels, type ListMode } from "@/types/taskTypes";

type Props = {
  mode: ListMode;
};

export function EmptyState({ mode }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="rounded-3xl border border-dashed border-white/25 bg-white/5 p-8 text-center light:border-slate-300 light:bg-white/70"
    >
      <div className="mx-auto mb-3 h-16 w-16 rounded-2xl bg-white/10 light:bg-slate-100" />
      <h3 className="text-sm font-semibold">No items yet in {modeLabels[mode]}</h3>
      <p className="mt-1 text-xs text-slate-300 light:text-slate-600">
        Tap the add button to create your first entry.
      </p>
    </motion.div>
  );
}
