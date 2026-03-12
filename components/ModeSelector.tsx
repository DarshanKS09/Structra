import { motion } from "framer-motion";
import { type ListMode, modeHints, modeLabels } from "@/types/taskTypes";

const modeIcons: Record<ListMode, string> = {
  task: "✓",
  grocery: "◉",
  habit: "↻",
  study: "✦",
  fitness: "⚡",
  shopping: "◈",
  meeting: "✎"
};

type Props = {
  onSelect: (mode: ListMode) => void;
};

const modes = Object.keys(modeLabels) as ListMode[];

export function ModeSelector({ onSelect }: Props) {
  return (
    <section className="mx-auto w-full max-w-4xl px-4 pb-24 pt-8 md:px-8">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="mb-7 space-y-2"
      >
        <h1 className="text-2xl font-bold tracking-tight md:text-4xl">
          What type of list do you want to create?
        </h1>
        <p className="text-sm text-slate-300 md:text-base dark:text-slate-300 light:text-slate-600">
          Pick a mode and start capturing things with minimal friction.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {modes.map((mode, idx) => (
          <motion.button
            key={mode}
            type="button"
            onClick={() => onSelect(mode)}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: idx * 0.045 }}
            whileHover={{ y: -3, scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            className="rounded-3xl border border-border bg-surface p-5 text-left shadow-glass backdrop-blur-xl transition-colors hover:bg-white/15 themed-accent-border light:border-slate-300 light:bg-white/65 light:hover:bg-white"
          >
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-xl light:bg-slate-100">
              {modeIcons[mode]}
            </div>
            <h3 className="text-lg font-semibold">{modeLabels[mode]}</h3>
            <p className="mt-1 text-sm text-slate-300 light:text-slate-600">{modeHints[mode]}</p>
          </motion.button>
        ))}
      </div>
    </section>
  );
}
