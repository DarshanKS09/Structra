import { type TouchEvent, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { type ListItem, type ListMode } from "@/types/taskTypes";

type Props = {
  item: ListItem;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
};

const modeAccent: Record<ListMode, string> = {
  task: "from-sky-300/30 to-cyan-300/10",
  grocery: "from-emerald-300/30 to-green-300/10",
  habit: "from-orange-300/30 to-amber-300/10",
  study: "from-violet-300/30 to-indigo-300/10",
  fitness: "from-pink-300/30 to-rose-300/10",
  shopping: "from-fuchsia-300/30 to-pink-300/10",
  meeting: "from-slate-300/30 to-gray-300/10"
};

const completionStatus = (item: ListItem) =>
  "completed" in item ? item.completed : "purchased" in item ? item.purchased : false;

export function ItemCard({ item, onToggle, onDelete, onEdit }: Props) {
  const startX = useRef(0);
  const [offsetX, setOffsetX] = useState(0);
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
        className="relative z-10 rounded-3xl border border-white/15 bg-gradient-to-r p-4 shadow-glass backdrop-blur-xl light:border-slate-300 light:bg-white"
      >
        <div className={`absolute inset-0 rounded-3xl bg-gradient-to-r ${modeAccent[item.mode]}`} />
        <div className="relative z-10">
          <div className="flex items-start gap-3">
            {canToggle ? (
              <button
                type="button"
                onClick={onToggle}
                className={`mt-0.5 h-6 w-6 shrink-0 rounded-full border-2 ${
                  completed ? "border-emerald-300 bg-emerald-300" : "border-slate-300/80"
                }`}
                aria-label="Toggle complete"
              />
            ) : (
              <span className="mt-1 h-5 w-5 shrink-0 rounded-full border border-slate-400/70" />
            )}
            <div className="min-w-0 flex-1">
              <h3 className={`text-sm font-semibold ${completed ? "line-through opacity-70" : ""}`}>
                {details.title}
              </h3>
              <p className="mt-1 text-xs text-slate-300 light:text-slate-600">{details.subtitle}</p>
              {details.meta.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {details.meta.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-white/20 bg-white/5 px-2 py-1 text-[11px] text-slate-200 light:border-slate-300 light:bg-slate-100 light:text-slate-700"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="h-9 rounded-xl border border-white/20 px-3 text-xs light:border-slate-300"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="h-9 rounded-xl bg-rose-500 px-3 text-xs font-semibold text-white"
            >
              Delete
            </button>
          </div>
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
