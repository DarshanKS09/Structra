import { ModeList } from "@/components/ModeList";
import { type ListItem } from "@/types/taskTypes";

type Props = {
  items: ListItem[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
};

export function StudyList({ items, onToggle, onDelete, onEdit }: Props) {
  return <ModeList mode="study" items={items} onToggle={onToggle} onDelete={onDelete} onEdit={onEdit} />;
}
