import { type TouchEvent, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { type ListItem } from "@/types/taskTypes";

type Props = {
  item: ListItem;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
};

const completionStatus = (item: ListItem) =>
  "completed" in item ? item.completed : "purchased" in item ? item.purchased : false;

export function ItemCard({ item, onToggle, onDelete, onEdit }: Props) {
  const startX = useRef(0);
  const [offsetX, setOffsetX] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const completed = completionStatus(item);
  const canToggle = item.mode !== "meeting";
  const details = useMemo(() => getDetails(item), [item]);

  const handleTouchStart = (event: TouchEvent) => {
    startX.current = event.touches[0].clientX;
  };

  const handleTouchMove = (event: TouchEvent) => {
    const delta = event.touches[0].clientX - startX.current;
    if (delta < 0) setOffsetX(Math.max(delta, -120));
  };

  const handleTouchEnd = () => {
    if (offsetX < -75) onDelete();
    setOffsetX(0);
  };

  return (
    <div className="relative overflow-hidden rounded-3xl">
      <div className="absolute inset-y-0 right-0 flex w-24 items-center justify-center rounded-3xl bg-rose-500 text-sm font-semibold text-white">
        Delete
      </div>
      <motion.article
        layout
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0, x: offsetX }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.2 }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="themed-item relative z-10 rounded-xl border border-white/15 p-2.5 shadow-glass backdrop-blur-xl"
      >
        <div className="relative z-10">
          <div
            onClick={() => setExpanded((prev) => !prev)}
            className="flex w-full cursor-pointer items-center gap-2.5 text-left"
          >
            {canToggle ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggle();
                }}
                className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 ${
                  completed ? "border-emerald-300 bg-emerald-300" : "border-slate-300/80"
                }`}
                aria-label="Toggle complete"
              />
            ) : (
              <span className="mt-1 h-4 w-4 shrink-0 rounded-full border border-slate-400/70" />
            )}
            <div className="min-w-0 flex-1">
              <h3 className={`truncate text-sm font-semibold ${completed ? "line-through opacity-70" : ""}`}>
                {details.title}
              </h3>
              <p className="truncate text-[11px] text-slate-300">{details.meta[0] || details.subtitle}</p>
            </div>
            <span className="text-xs text-slate-300">{expanded ? "▲" : "▼"}</span>
          </div>
          {expanded && (
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onEdit}
                className="h-8 rounded-lg border border-white/20 px-3 text-[11px]"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="h-8 rounded-lg bg-rose-500 px-3 text-[11px] font-semibold text-white"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </motion.article>
    </div>
  );
}

function getDetails(item: ListItem) {
  switch (item.mode) {
    case "task":
      return {
        title: item.title,
        subtitle: item.description || "No description",
        meta: [item.priority, item.dueDate ? `Due ${item.dueDate}` : "No due date"]
      };
    case "grocery":
      return {
        title: item.itemName,
        subtitle: "Grocery item",
        meta: [`${item.quantity} ${item.unit}`]
      };
    case "habit":
      return {
        title: item.habitName,
        subtitle: `${item.frequency} routine`,
        meta: [`Streak ${item.streak}`]
      };
    case "study":
      return {
        title: `${item.subject}: ${item.topic}`,
        subtitle: "Study session",
        meta: [item.estimatedStudyTime]
      };
    case "fitness":
      return {
        title: item.exerciseName,
        subtitle: "Workout",
        meta: [`${item.sets} sets`, `${item.reps} reps`, item.duration]
      };
    case "shopping":
      return {
        title: item.itemName,
        subtitle: "Wishlist item",
        meta: [`$${item.price}`, item.priority]
      };
    case "meeting":
      return {
        title: item.meetingTitle,
        subtitle: item.participants || "No participants",
        meta: [item.date || "No date"]
      };
  }
}
