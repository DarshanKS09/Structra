"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";
import { modeLabels, type ListMode } from "@/types/taskTypes";
import type { DashboardItem } from "@/lib/dashboard/prioritize";
import type { DashboardSectionView } from "@/lib/hooks/useDashboard";
import type { TaskAnalytics } from "@/lib/data/analytics";
import type { StudyAnalytics } from "@/lib/data/studyAnalytics";
import type { ReminderRow } from "@/lib/data/reminders";
import {
  TaskProgressCard,
  StudyProgressCard,
  GrocerySummaryCard,
  ReminderCard
} from "@/components/analytics/AnalyticsCards";

/**
 * The Dashboard.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS NOT
 * ---------------------------------------------------------------------------
 * It is not a data-entry screen and not a stack of raw lists. Its whole job is
 * to answer one question - "what do I need to take care of?" - so the layout is
 * ordered by that question, not by section:
 *
 *   1. headline counts   how bad is it right now
 *   2. Do first          late or due today, ranked
 *   3. Up next           everything else still open, ranked
 *   4. by section        summaries, with the ones holding nothing collapsed
 *   5. wishlist          saved but not a commitment, kept strictly separate
 *
 * Completed work is never listed. It is a count, because a list of things you
 * already finished does not help anyone decide what to do next.
 *
 * ---------------------------------------------------------------------------
 * WISHLIST IS DELIBERATELY SEPARATE
 * ---------------------------------------------------------------------------
 * A shopping wishlist entry is not an obligation, so it never competes for a
 * place in the priority bands. Folding it in would rank "maybe buy a lamp" above
 * "submit the overdue project", which is exactly the kind of noise this screen
 * exists to remove.
 */

const URGENCY_STYLES: Record<DashboardItem["urgency"], string> = {
  overdue: "bg-rose-500/20 text-rose-200 border-rose-400/40 light:text-rose-700",
  today: "bg-amber-500/20 text-amber-200 border-amber-400/40 light:text-amber-700",
  soon: "bg-sky-500/15 text-sky-200 border-sky-400/30 light:text-sky-700",
  later: "bg-white/10 text-slate-300 border-white/20 light:text-slate-600",
  none: "bg-white/10 text-slate-300 border-white/20 light:text-slate-600"
};

const URGENCY_WORDS: Record<DashboardItem["urgency"], string> = {
  overdue: "Overdue",
  today: "Due today",
  soon: "Upcoming",
  later: "Later",
  none: "Open"
};

const MODE_CHIP: Record<ListMode, string> = {
  task: "bg-sky-500/15 text-sky-200 light:text-sky-700",
  grocery: "bg-emerald-500/15 text-emerald-200 light:text-emerald-700",
  habit: "bg-violet-500/15 text-violet-200 light:text-violet-700",
  study: "bg-indigo-500/15 text-indigo-200 light:text-indigo-700",
  fitness: "bg-orange-500/15 text-orange-200 light:text-orange-700",
  shopping: "bg-pink-500/15 text-pink-200 light:text-pink-700",
  meeting: "bg-teal-500/15 text-teal-200 light:text-teal-700"
};

function Card({
  title,
  subtitle,
  count,
  accent,
  children
}: {
  title: string;
  subtitle?: string;
  count?: number;
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
      className="rounded-3xl border border-border bg-surface p-4 shadow-glass backdrop-blur-xl light:border-slate-300 light:bg-white/70 md:p-5"
    >
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h2 className={`text-base font-semibold tracking-tight md:text-lg ${accent ?? ""}`}>
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-slate-400 light:text-slate-500">{subtitle}</p>
          ) : null}
        </div>
        {count !== undefined ? (
          <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold light:bg-slate-100 light:text-slate-700">
            {count}
          </span>
        ) : null}
      </header>
      {children}
    </motion.section>
  );
}

/** One actionable row, with an optional complete control. */
function PriorityRow({
  entry,
  index,
  onComplete,
  showReason
}: {
  entry: DashboardItem;
  index: number;
  onComplete?: (entry: DashboardItem) => void;
  showReason?: boolean;
}) {
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 light:border-slate-200 light:bg-white/60">
      <span className="mt-0.5 w-5 shrink-0 text-xs font-semibold text-slate-400 light:text-slate-500">
        {index + 1}.
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{entry.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span
            className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${MODE_CHIP[entry.mode]}`}
          >
            {modeLabels[entry.mode]}
          </span>
          {entry.urgency !== "none" ? (
            <span
              className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${URGENCY_STYLES[entry.urgency]}`}
            >
              {URGENCY_WORDS[entry.urgency]}
            </span>
          ) : null}
        </div>
        {showReason && entry.reasons.length > 0 ? (
          <p className="mt-1 truncate text-[11px] text-slate-400 light:text-slate-500">
            {entry.reasons.join(" · ")}
          </p>
        ) : null}
      </div>

      {onComplete ? (
        <button
          type="button"
          onClick={() => onComplete(entry)}
          aria-label={`Mark ${entry.title} done`}
          className="h-9 w-9 shrink-0 rounded-xl border border-white/20 text-sm transition hover:border-white/50 hover:bg-white/10 light:border-slate-300"
          title="Mark done"
        >
          ✓
        </button>
      ) : null}
    </li>
  );
}

type Props = {
  sections: DashboardSectionView[];
  priority: { doFirst: DashboardItem[]; upNext: DashboardItem[]; nothingUrgent: boolean };
  totals: {
    overdue: number;
    dueToday: number;
    pending: number;
    completed: number;
    wishlist: number;
  };
  greeting: string;
  onComplete: (entry: DashboardItem) => void;
  onOpenSection: (mode: ListMode) => void;
  isRefreshing: boolean;
  /** Analytics readouts. Null when that read failed, so the card is omitted. */
  taskAnalytics: TaskAnalytics | null;
  studyAnalytics: StudyAnalytics | null;
  dueReminders: ReminderRow[];
  groceryHistoryCount: number;
  onDismissReminder: (taskId: string) => void;
};

export function Dashboard({
  sections,
  priority,
  totals,
  greeting,
  onComplete,
  onOpenSection,
  isRefreshing,
  taskAnalytics,
  studyAnalytics,
  dueReminders,
  groceryHistoryCount,
  onDismissReminder
}: Props) {
  // Sections are split so the ones the user has not used do not crowd out the
  // ones holding real work.
  const { active, quiet, wishlists } = useMemo(() => {
    const active: DashboardSectionView[] = [];
    const quiet: DashboardSectionView[] = [];
    const wishlists: DashboardSectionView[] = [];
    for (const section of sections) {
      if (section.mode === "shopping") {
        if (section.wishlist.length > 0) wishlists.push(section);
      } else if (section.pending.length > 0 || section.buckets.completedCount > 0) {
        active.push(section);
      } else {
        quiet.push(section);
      }
    }
    return { active, quiet, wishlists };
  }, [sections]);

  // "Up next" is capped so this stays a summary rather than a second task list;
  // the full set is always reachable in the section itself.
  const upNext = priority.upNext.slice(0, 6);
  const doFirst = priority.doFirst.slice(0, 8);

  // The grocery card needs "how many are still to buy", which is the grocery
  // section's pending count - not the workspace total of every grocery row.
  const activeGroceryCount =
    sections.find((section) => section.mode === "grocery")?.pending.length ?? 0;

  return (
    <div className="space-y-4" aria-busy={isRefreshing}>
      {/* --- headline ---------------------------------------------------- */}
      <header className="rounded-3xl border border-border bg-surface p-5 shadow-glass backdrop-blur-xl light:border-slate-300 light:bg-white/70 md:p-6">
        <p className="text-xs uppercase tracking-wide text-slate-400 light:text-slate-500">
          {greeting}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">
          {totals.overdue > 0
            ? `${totals.overdue} item${totals.overdue === 1 ? "" : "s"} need attention`
            : totals.pending > 0
              ? `${totals.pending} thing${totals.pending === 1 ? "" : "s"} on your plate`
              : "You are all caught up"}
        </h1>
        <p className="mt-1 text-sm text-slate-400 light:text-slate-500">
          {totals.overdue > 0
            ? "Overdue work is listed first."
            : totals.pending > 0
              ? "Nothing is late. Here is what is coming up."
              : "Add something from any section to get started."}
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              ["Overdue", totals.overdue, "text-rose-300 light:text-rose-700"],
              ["Due today", totals.dueToday, "text-amber-300 light:text-amber-700"],
              ["Pending", totals.pending, "text-slate-200 light:text-slate-800"],
              ["Completed", totals.completed, "text-emerald-300 light:text-emerald-700"]
            ] as const
          ).map(([label, value, tone]) => (
            <div
              key={label}
              className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 light:border-slate-200 light:bg-white/60"
            >
              <dt className="text-[11px] uppercase tracking-wide text-slate-400 light:text-slate-500">
                {label}
              </dt>
              <dd className={`text-xl font-bold ${value > 0 ? tone : "text-slate-500"}`}>{value}</dd>
            </div>
          ))}
        </dl>
      </header>

      {/* --- do first ---------------------------------------------------- */}
      <Card
        title="Do first"
        subtitle={
          priority.nothingUrgent
            ? "Nothing is overdue or due today"
            : "Overdue and due today, most urgent first"
        }
        count={priority.doFirst.length}
        accent={priority.doFirst.length > 0 ? "text-rose-200 light:text-rose-700" : undefined}
      >
        {doFirst.length === 0 ? (
          <p className="py-2 text-sm text-slate-400 light:text-slate-500">
            {totals.pending > 0
              ? "Nothing is late. Check “Up next” below."
              : "No pending items. Add one from any section."}
          </p>
        ) : (
          <ul className="space-y-2">
            {doFirst.map((entry, index) => (
              <PriorityRow
                key={entry.key}
                entry={entry}
                index={index}
                onComplete={onComplete}
                showReason
              />
            ))}
          </ul>
        )}
      </Card>

      {/* --- up next ----------------------------------------------------- */}
      <Card
        title="Up next"
        subtitle="Still open, soonest first"
        count={totals.pending}
      >
        {upNext.length === 0 ? (
          <p className="py-2 text-sm text-slate-400 light:text-slate-500">
            Nothing else pending.
          </p>
        ) : (
          <ul className="space-y-2">
            {upNext.map((entry, index) => (
              <PriorityRow
                key={entry.key}
                entry={entry}
                index={priority.doFirst.length + index}
                onComplete={onComplete}
              />
            ))}
          </ul>
        )}
        {priority.upNext.length > upNext.length ? (
          <p className="mt-2 text-[11px] text-slate-400 light:text-slate-500">
            +{priority.upNext.length - upNext.length} more in their sections
          </p>
        ) : null}
      </Card>

      {/*
          Reminders sit ABOVE the analytics: a reminder is an action item, not a
          statistic, and burying "you asked to be reminded about this" under
          charts would defeat it.
        */}
      <ReminderCard reminders={dueReminders} onDismiss={onDismissReminder} />

      {/*
          Two compact cards, each answering one question and each linking to a
          detailed view. They are deliberately NOT merged into the priority bands:
          analytics describe the workload, while the bands tell the user what to
          do next, and merging them would blur both.
        */}
      <div className="grid gap-4 md:grid-cols-2">
        {taskAnalytics ? <TaskProgressCard analytics={taskAnalytics} /> : null}
        {studyAnalytics ? <StudyProgressCard analytics={studyAnalytics} /> : null}
      </div>

      <GrocerySummaryCard
        activeCount={activeGroceryCount}
        historyCount={groceryHistoryCount}
      />

      {/* --- by section -------------------------------------------------- */}
      {active.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {active.map((section) => (
            <Card
              key={section.mode}
              title={section.label}
              subtitle={section.summary}
              count={section.pending.length}
            >
              <ul className="space-y-1.5">
                {section.pending.slice(0, 4).map((entry) => (
                  <li key={entry.key} className="flex items-center gap-2 text-sm">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/40 light:bg-slate-400" />
                    <span className="truncate">{entry.title}</span>
                    {entry.urgency === "overdue" || entry.urgency === "today" ? (
                      <span
                        className={`ml-auto shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${URGENCY_STYLES[entry.urgency]}`}
                      >
                        {URGENCY_WORDS[entry.urgency]}
                      </span>
                    ) : null}
                  </li>
                ))}
                {section.pending.length > 4 ? (
                  <li className="text-[11px] text-slate-400 light:text-slate-500">
                    +{section.pending.length - 4} more
                  </li>
                ) : null}
              </ul>
              <button
                type="button"
                onClick={() => onOpenSection(section.mode)}
                className="mt-3 text-xs font-semibold underline underline-offset-2"
              >
                Open {section.label}
              </button>
            </Card>
          ))}
        </div>
      ) : null}

      {/* --- wishlist ---------------------------------------------------- */}
      {wishlists.length > 0 ? (
        <Card
          title="Wishlist"
          subtitle="Saved for later - not counted as pending work"
          count={totals.wishlist}
        >
          <ul className="space-y-1.5">
            {wishlists.flatMap((section) =>
              section.wishlist.map((entry) => (
                <li key={entry.key} className="flex items-center gap-2 text-sm">
                  <span className="truncate">{entry.title}</span>
                  {entry.detail !== "Wishlist" ? (
                    <span className="ml-auto shrink-0 text-[11px] text-slate-400 light:text-slate-500">
                      {entry.detail}
                    </span>
                  ) : null}
                </li>
              ))
            ).slice(0, 8)}
          </ul>
          <button
            type="button"
            onClick={() => onOpenSection("shopping")}
            className="mt-3 text-xs font-semibold underline underline-offset-2"
          >
            Open Shopping Wishlist
          </button>
        </Card>
      ) : null}

      {/* --- empty sections ----------------------------------------------- */}
      {quiet.length > 0 ? (
        <Card title="Nothing here yet" subtitle="Sections with no activity">
          <div className="flex flex-wrap gap-2">
            {quiet.map((section) => (
              <button
                key={section.mode}
                type="button"
                onClick={() => onOpenSection(section.mode)}
                className="rounded-xl border border-white/20 px-3 py-1.5 text-xs transition hover:border-white/50 light:border-slate-300"
              >
                {section.label}
              </button>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}