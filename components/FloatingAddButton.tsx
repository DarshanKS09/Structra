import { motion } from "framer-motion";

type Props = {
  onClick: () => void;
  inline?: boolean;
};

export function FloatingAddButton({ onClick, inline = false }: Props) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.94 }}
      className={
        inline
          ? "themed-accent mb-3 flex h-12 w-full items-center justify-center rounded-2xl text-sm font-semibold"
          : "themed-accent fixed bottom-24 right-5 z-30 h-14 w-14 rounded-2xl text-3xl font-medium leading-none md:bottom-8 md:right-8"
      }
      aria-label="Add item"
    >
      {inline ? "Add New Item" : "+"}
    </motion.button>
  );
}
