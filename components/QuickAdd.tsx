"use client";

import { AnimatePresence, motion } from "framer-motion";
import { QUICK_ADD_MODES } from "@/components/NavBar";
import type { ListMode } from "@/types/taskTypes";

/**
 * Quick-add chooser.
 *
 * ---------------------------------------------------------------------------
 * SCOPE
 * ---------------------------------------------------------------------------
 * The Dashboard organises and summarises; it is not where data is entered. So
 * the only thing it offers is a way to CHOOSE which section an item belongs to,
 * which then hands off to that section's existing form. Every field, validation
 * and write path stays exactly where it already was - this component invents no
 * fields of its own, which is why it cannot drift from the section forms.
 */

type Props = {
  /** Visible. */
  open: boolean;
  /** Where a picked item should be created. */
  onPick: (mode: ListMode) => void;
  onClose: () => void;
};

export function QuickAdd({ open, onPick, onClose }: Props) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm md:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Add something"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.2 }}
            // Stop a click inside the sheet from closing it.
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md rounded-3xl border border-white/15 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-xl light:border-slate-300 light:bg-white"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">Add something</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="h-8 w-8 rounded-lg text-sm opacity-70 transition hover:opacity-100"
              >
                ✕
              </button>
            </div>
            <p className="mb-3 text-xs text-slate-400 light:text-slate-500">
              Choose where it belongs. You will get that section&apos;s own form.
            </p>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {QUICK_ADD_MODES.map((option) => (
                <motion.button
                  key={option.mode}
                  type="button"
                  onClick={() => onPick(option.mode)}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  className="flex flex-col items-start gap-1 rounded-2xl border border-white/20 bg-white/5 px-3 py-2.5 text-left transition hover:border-white/50 light:border-slate-300 light:bg-white/70"
                >
                  <span className="text-lg" aria-hidden>
                    {option.icon}
                  </span>
                  <span className="text-xs font-medium">{option.label}</span>
                </motion.button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}