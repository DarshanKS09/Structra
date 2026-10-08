import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { type ListItem } from "@/types/taskTypes";
import { formatDeadline } from "@/lib/data/adapters";

type Props = {
  item: ListItem;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
};

const completionStatus = (item: ListItem) =>
  "completed" in item ? item.completed : "purchased" in item ? item.purchased : false;

export function ItemCard({ item, onToggle, onDelete, onEdit }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [celebrateKey, setCelebrateKey] = useState(0);
  const completed = completionStatus(item);
  const canToggle = item.mode !== "meeting";
  const details = useMemo(() => getDetails(item), [item]);

  return (
    <div className="relative overflow-hidden rounded-xl">
      <motion.article
        layout
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.2 }}
        whileHover={{ y: -1, scale: 1.005 }}
        className="themed-item relative z-10 rounded-xl border border-white/15 p-2.5 shadow-glass backdrop-blur-xl"
      >
        <div className="relative z-10">
          <div
            onClick={() => setExpanded((prev) => !prev)}
            className="flex w-full cursor-pointer items-center gap-2.5 text-left"
          >
            {canToggle ? (
              <div className="relative">
                <motion.button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!completed) setCelebrateKey((prev) => prev + 1);
                    onToggle();
                  }}
                  animate={completed ? { scale: [1, 1.2, 1] } : { scale: 1 }}
                  transition={{ duration: 0.25 }}
                  className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 ${
                    completed ? "border-emerald-300 bg-emerald-300" : "border-slate-300/80"
                  }`}
                  aria-label="Toggle complete"
                />
                <CelebrateBurst burstKey={celebrateKey} />
              </div>
            ) : (
              <span className="mt-1 h-4 w-4 shrink-0 rounded-full border border-slate-400/70" />
            )}
            <div className="min-w-0 flex-1">
              <h3 className={`truncate text-sm font-semibold ${completed ? "line-through opacity-70" : ""}`}>
                {details.title}
              </h3>
              {/*
              Both meta entries render, not just the first. Previously
              `meta[0] || subtitle` meant a task's deadline - the one thing
              that says whether it is late - was computed and then never shown.

              The task deadline is colour-coded with the same urgency palette as
              the Dashboard, so a list row and a dashboard badge agree on what
              "overdue" looks like.
            */}
            <div className="mt-0.5 flex items-center gap-1.5 overflow-hidden">
              {details.meta.filter(Boolean).map((entry, index) => (
                <span
                  key={index}
                  className={`truncate text-[11px] ${
                    index === 0 ? "text-slate-400 light:text-slate-500" : details.metaClass ?? "text-slate-300"
                  }`}
                >
                  {index > 0 ? "· " : ""}
                  {entry}
                </span>
              ))}
              {details.meta.every((entry) => !entry) ? (
                <span className="truncate text-[11px] text-slate-300">{details.subtitle}</span>
              ) : null}
            </div>
            </div>
            <span className="text-xs text-slate-300">{expanded ? "^" : "v"}</span>
          </div>
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18 }}
                className="mt-2 flex items-center justify-end gap-2 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={onEdit}
                  className="h-8 rounded-lg border border-white/20 px-3 text-[11px] transition hover:border-white/40 hover:bg-white/10"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  className="h-8 rounded-lg bg-rose-500 px-3 text-[11px] font-semibold text-white transition hover:bg-rose-400"
                >
                  Delete
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.article>
    </div>
  );
}

function CelebrateBurst({ burstKey }: { burstKey: number }) {
  const dots = [
    { x: -14, y: -10, color: "#22c55e" },
    { x: 0, y: -16, color: "#f59e0b" },
    { x: 14, y: -8, color: "#60a5fa" },
    { x: 12, y: 8, color: "#f472b6" },
    { x: -10, y: 10, color: "#34d399" }
  ];

  return (
    <AnimatePresence>
      {burstKey > 0 && (
        <div key={burstKey} className="pointer-events-none absolute left-2 top-2">
          {dots.map((dot, idx) => (
            <motion.span
              key={`${burstKey}-${idx}`}
              initial={{ x: 0, y: 0, scale: 0.4, opacity: 0.95 }}
              animate={{ x: dot.x, y: dot.y, scale: 1, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.55, ease: "easeOut" }}
              className="absolute h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: dot.color }}
            />
          ))}
        </div>
      )}
    </AnimatePresence>
  );
}

/**
 * A human deadline label that says how late something is.
 *
 * The urgency word is the point: "Due 8 Oct, 14:30" on its own does not tell a
 * user whether they have already missed it. Uses the same vocabulary and colours
 * as the Dashboard's urgency badges so the two screens agree on what "overdue"
 * means.
 *
 * Legacy tasks with no deadline say so plainly rather than implying anything.
 */
function deadlineLabel(dueAt: string | null, completed: boolean): string {
  if (!dueAt) return "No deadline";
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return "No deadline";

  const when = formatDeadline(dueAt);
  if (completed) return `Completed · was due ${when}`;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const days = Math.round((startOfDueDay - startOfToday) / 86_400_000);

  if (due.getTime() < now.getTime() && days < 0) {
    const late = Math.abs(days);
    return `Overdue · ${late === 1 ? "1 day" : `${late} days`} late`;
  }
  if (days === 0) return `Due today · ${when}`;
  if (days === 1) return "Due tomorrow";
  return `Due ${when}`;
}

/** Tone for the task deadline, matching the Dashboard urgency palette. */
function deadlineTone(dueAt: string | null, completed: boolean): string {
  if (!dueAt) return "text-slate-400 light:text-slate-500";
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime()) || completed) {
    return "text-slate-400 light:text-slate-500";
  }
  if (due.getTime() < Date.now()) return "text-rose-300 light:text-rose-600";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const days = Math.round((startOfDueDay - startOfToday) / 86_400_000);
  if (days === 0) return "text-amber-300 light:text-amber-600";
  if (days <= 3) return "text-sky-300 light:text-sky-600";
  return "text-slate-300";
}

function getDetails(item: ListItem) {
  switch (item.mode) {
    case "task":
      return {
        title: item.title,
        subtitle: item.description || "No description",
        meta: [item.priority, deadlineLabel(item.dueDate || null, item.completed)],
        metaClass: deadlineTone(item.dueDate || null, item.completed)
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
