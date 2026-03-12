import { AnimatePresence } from "framer-motion";
import { EmptyState } from "@/components/EmptyState";
import { ItemCard } from "@/components/ItemCard";
import { type ListItem, type ListMode } from "@/types/taskTypes";

type Props = {
  mode: ListMode;
  items: ListItem[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
};

export function ModeList({ mode, items, onToggle, onDelete, onEdit }: Props) {
  if (!items.length) return <EmptyState mode={mode} />;

  return (
    <div className="space-y-3 pb-28 md:pb-10">
      <AnimatePresence>
        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            onToggle={() => onToggle(item.id)}
            onDelete={() => onDelete(item.id)}
            onEdit={() => onEdit(item.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
