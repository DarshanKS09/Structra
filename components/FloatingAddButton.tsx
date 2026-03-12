import { motion } from "framer-motion";

type Props = {
  onClick: () => void;
};

export function FloatingAddButton({ onClick }: Props) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.94 }}
      className="fixed bottom-24 right-5 z-30 h-14 w-14 rounded-2xl bg-sky-400 text-3xl font-medium leading-none text-slate-900 shadow-lg shadow-sky-400/40 md:bottom-8 md:right-8"
      aria-label="Add item"
    >
      +
    </motion.button>
  );
}
